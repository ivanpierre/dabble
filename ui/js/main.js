
var editor, history, engine, browser;
var browserAction = null, browserStatus = '';
var historyBuffer = [];
var maxHistory = 200;
var lineIndex = 0; // for moving through the history
var lineWidgetCount = 0;

/**
* Trim string proto
*/
if (typeof(String.prototype.trim) === "undefined") {
    String.prototype.trim = function() {
        return String(this).replace(/^\s+|\s+$/g, '');
    };
}


/**
* Uniq array proto
*/
Array.prototype.getUnique = function(selector){
   var u = {}, a = [];
   for(var i = 0, l = this.length; i < l; ++i){
      if(u.hasOwnProperty(selector(this[i]))) {
         continue;
      }
      a.push(this[i]);
      u[selector(this[i])] = 1;
   }
   return a;
}


/**
* Autocomplete
*/
CodeMirror.commands.autocomplete = function(cm) {
    CodeMirror.showHint(cm, CodeMirror.dHint, {
        async: true,
        completeSingle: false
    });
}


function windowResize() {
	$('#content').height(window.innerHeight - $("#header").height() - $("#footer").height());
	scrollToBottom($("#code-pane > div:first-child"));
}


shortcut.add("Ctrl+Shift+J",function() { 
    require('nw.gui').Window.get().showDevTools();
});    

shortcut.add("Ctrl+H",function() { 
    toggleSearchPaneVisibility();
});    


/**
* On-load setup
*/
$(document).ready(function () {
	
	windowResize();
    $(window).resize(windowResize);              
	
    require('fs').watch('../../ui/css/style.css', function (event, name) {
        var queryString = '?reload=' + new Date().getTime();
        $('link[rel="stylesheet"]').each(function () {
            this.href = this.href.replace(/\?.*|$/, queryString);
        });
		setTimeout(windowResize, 500);
    });

    editor = CodeMirror.fromTextArea(document.getElementById("code"), {
        mode: "text/x-d",
        viewportMargin: Infinity,
        lineWrapping: true,
        smartIndent: false,
        extraKeys: { "Ctrl-Down": "autocomplete" }
    });

    history = CodeMirror.fromTextArea(document.getElementById("history"), {
        mode: "text/x-d",
        viewportMargin: Infinity,
        readOnly: true,
        lineNumbers: true,
        lineWrapping: true
    });

    editor.setOption("theme", "dabble");
    history.setOption("theme", "dabble");

    editor.options.onKeyEvent = function (cm, e) {
        // If currently auto-completing, do nothing
        if (e.ctrlKey == true) return;
        if (editor.state.completionActive) return;
        if (!e || !(e instanceof KeyboardEvent)) return;

        if (e.type == 'keydown' && e.shiftKey == false && e.keyCode == 13) {            
            replInput();	
			e.preventDefault();
            return true;
        } else if (e.type == 'keydown' && editor.lineCount() == 1 && (e.keyCode == 38 || e.keyCode == 40)) {
            var line = "";
            if (e.keyCode == 38) line = retrieveHistory('up');
            else line = retrieveHistory('down');
            if (typeof line != "undefined") {
                editor.setValue(line);				
				setTimeout( function() { editor.setCursor(editor.lineCount(), 0); }, 50);								
			}
        }
    };


    (function () {
        CodeMirror.dHint = function (editor, callback, options) {
            var cursor = editor.getCursor();
            var tk = editor.getTokenAt(cursor);
            browserAction = function (json) {
                if (json.length == 0) return;
                callback({
					list: json,
                    from: CodeMirror.Pos(cursor.line, tk.start),
                    to: CodeMirror.Pos(cursor.line, tk.end)
                });                
            };
            browser.stdin.write(new Buffer('suggest-names:' + tk.string.toLowerCase() + '\n'));
        };
    } ());


    /**
    * Start repl
    */
	engine = require('child_process').spawn('../repl', ['--noConsole']);	
	engine.stdout.on('data', function (data) { filterMessages(data.toString()); });	
    send("version");
    

    /**
    * Start browser
    */
	browser = require('child_process').spawn('../browser', ['c:/users/cal/d/dmd2/src/phobos/std']);	    
    browser.stdout.on('data', function (data) {
        if (browserAction !== null) {
            try {
                var json = JSON.parse(data.toString());
                browserAction(json);
            } catch (error) {
				$("#ajax-loader").css("visibility", "hidden");
                console.log("Browser stdout error converting to JSON: ", error);
            }
        } else {
            browserStatus = data.toString();
        }
    });

});


/**
* Take input text, handle it
*/
function replInput() {
	var text = editor.getValue();           		
	if (text.trim() == "clear") clear();				
	else {
		appendHistory(text);        
		updateResult(text, false);
		send(text);
	}
	editor.setValue("");                
}


/**
* Clear history and send request for version/title string.
*/
function clear() {
	history.setValue("");
	send("version");
}

/**
* Filter responses from the repl engine
*/
function filterMessages(str)
{	
	str = str.replace(/(\r\r\n|\r\n|\n|\r)/g, "<br>");       
	str = str.replace(/\u0009/g, "   ");
	
	//console.log("Diag: ", str, new Buffer(str));
	
	var parts = str.split(/\u0006/g);	
	for(var i = 0; p = parts[i], i < parts.length; i++) {		
		if (p.replace(/<br>/g,'').trim().length == 0) 
			continue;
		
		var msg = null;
		try { 
			msg = JSON.parse(p); 
		} catch(error) {			
		}
		
		if (msg !== null && typeof msg === "object" && !Array.isArray(msg))
			handleMessage(msg);
		else
			updateResult(p, true);	
	}		
}


/** 
* Handle json messages
*/ 
function handleMessage(json)
{
	var multiline = false;
	switch (json.id) {
		case "parse-multiline":
			multiline = true;
			break;
		case "repl-result":
			filterMessages(json.summary, function(text) { updateResult(text, true); }, handleMessage);
			break;
		case "meta":
			if (json.cmd == "version")
				updateResult(json.summary, false);
			else
				updateResult(json.summary, true);	
			break;			
		default: 
			if (json.hasOwnProperty("summary")) 
				updateResult(json.summary, true);
			else 
				console.log("Unhandled message: ", json);
		break;
	}	
	if (multiline)
		$("#repl-status").html("Multi-line input");
	else
		$("#repl-status").html("");
}

/**
* Got a result from the repl
*/
function updateResult(data, lwidget) {	
    if (lwidget) {       
        var id = "lineWidget" + (lineWidgetCount++).toString();
        $("body").append("<div class='resultWidget' id='" + id + "'>" + data, + "</div>");
        history.addLineWidget(history.lineCount() - 1, $("#" + id)[0]);
    } else {
        cmAppend(history, data);
    }
    scrollToBottom($("#code-pane > div:first-child"));
}


/**
* Append text to codemirror text.
*/
function cmAppend(cm, text) {
    text = text.replace(/(\r\r\n|\r\n|\r)/g, "\n");
    text = text.split("\n").filter(function (el) { return el.length; }).join("\n")    
    if (cm.getValue() !== "") text = "\n" + text;
    cm.replaceRange(text, CodeMirror.Pos(cm.lastLine()));            
}


/**
* Append text to history
*/
function appendHistory(text) {    
    if (text.length == 0 || (historyBuffer.length > 1 && historyBuffer[historyBuffer.length-1] == text)) return;
    historyBuffer.push(text);
    if (historyBuffer.length > maxHistory)
        for(var i = 0; i < 10; i++)
            historyBuffer.shift();                    
    lineIndex = historyBuffer.length;
}


/**
* History lookup
*/
function retrieveHistory(dir) {
    if (dir == 'up') {
        if (lineIndex > 0)
            lineIndex--;
    } else if (dir == 'down') {
        if (lineIndex < historyBuffer.length - 1)
            lineIndex++;
    }
    return historyBuffer[lineIndex];
}


/**
* Send input to the repl
*/
function send(text) {   	    
    engine.stdin.write(new Buffer(text + "\n"));
}


function toggleSearchPaneVisibility() {

    var sp = document.getElementById('libPane'), 
        cp = document.getElementById('code-pane');    
    
    if (sp.style.display == "")
        sp.style.display = "none";
        
    if (sp.style.display == "inline-block") {       
        sp.style.display = "none";
        cp.style.width = "99%"; 
        editor.focus();   
    } else if (sp.style.display == "none") {                
        cp.style.width = "40%";        
        setTimeout(function() {
            sp.style.display = "inline-block";
            sp.style.width = "58%";
            $("#search-box").focus();
        }, 200);                                  
    }
}


function searchInput() {
    var prefix = $("#search-box").val();
	
    if (prefix.length == 0) {
		$("#ajax-loader").css("visibility", "hidden");	
        clearSuggestions();
        return;
    }                                           
    browserAction = function(json) {
		$("#ajax-loader").css("visibility", "hidden");
        if (json.length == 0) 
			clearSuggestions();
        else 
			$("#suggestionsPane").html(listToHTML(json));                    
    };
	$("#ajax-loader").css("visibility", "visible");
    browser.stdin.write(new Buffer('search-names:' + prefix.toLowerCase() + "\n"));   
}

function listToHTML(list) {
    var html = "";
    list.forEach( function(e) {
        html+="<div class='libPanel libPanelLevel1' data-expanded='false' onclick='panelClick(\""+e.uuid+"\")'>"+e.name+"</div>";
    });
    return html;
}

function panelClick(name) {   
    var el = event.target;           
    if (typeof el.dataset.expanded == "undefined") return;   
    if (el.dataset.expanded != "true") 
		expandPanel(name, el);
    else 
		collapsePanel(name, el);
}


function expandPanel(uuid, parent) {    
    browserAction = function(json) {        
        $(parent).append(symbolToHTML(json));        
        parent.dataset.expanded = "true";
    };     
    browser.stdin.write(new Buffer('get-uuid:' + uuid + "\n"));        
}

function collapsePanel(name, parent) {
    parent.removeChild(parent.firstChild.nextSibling); 
    parent.dataset.expanded = "false";
}

function symbolToHTML(symbol) {  
  return "<div class='libPanel libPanelLevel2'>" +
    symbol.parent + 
    "<br>" +   
    symbol.pretty +  
    "<br>" + 
    symbol.comment.replace(/\n/g, '<br>') +  
    /*"<div class='libPanelSrcButton' onclick='showSource(\""+symbol.uuid+"\")'>source</div>" +*/ 
    "</div>";    
}

function showSource(uuid) {
    var parent = event.target;
            
    post('/getSymbolSourceByUUID', uuid, function(xhr) {
            
        var html = xhr.responseText,             
            div = document.createElement("div");                  
                        
         console.log(xhr.responseText);
            
        parent.appendChild(div);
        div.innerHTML = html;          
    });
}

function clearSuggestions() {
    $("#suggestionsPane").html("");    
}


function scrollToBottom(jqEl) {
	jqEl.scrollTop(jqEl[0].scrollHeight);
}


/// <reference path="jquery-1.6.4.js" />

//$(document).ready(function () {
//    var sArray = {
//        "edit": { name: "Edit", icon: "edit" },
//        "cut": { name: "Cut", icon: "cut" },
//        "copy": { name: "Copy", icon: "copy" },
//        "paste": { name: "Paste", icon: "paste" },
//        "delete": { name: "Delete", icon: "delete" },
//        "sep1": "---------",
//        "quit": { name: "Quit", icon: "quit" }
//    }
//    //$cDiv = "#myhead";
    
//    $.contextMenu({ selector: '#myhead', callback: cBackfn, items: sArray });
//    $
//    var cBackfn = function (key, options) {
//        var m = "clicked: " + key;
//        window.console && console.log(m) || alert(m);
//    };
//    $("#web").click(function (e) {
//        e.preventDefault();
//        $cDiv.contextMenu(true);
//    });
//});
var mainstore = [];
var popAlert = function (header, msg) {
    var container = $('body');
    container.find('.cover').remove();
    if (container.css('z-index') === "auto") { zindex = 150; }
    else { zindex = container.css('z-index') + 1; }
    container.prepend("<div class='cover' style='height:20%; width:20%; background-color:transparent; position:absolute; z-index:" + zindex + ";'></div>");
    container.find('.cover').append("<div class='msgBox'><div id='headerBox' style='text-align:center; '> " + header + "</div><div id='clientMsg'></div><div id='buttonHolder'><span id='okButton'> Continue </span></div></div>");
    container.find('#clientMsg').html(msg);
    $msgPopBox = container.find('.cover').find('.msgBox');
    $cover = container.find('.cover');

    //Ceyword.centralize($cover, $msgPopBox);
    $('#okButton').click(function (event) { $cover.remove(); });
    $(document).keypress(function (e) {
        if (e.which == 13 && $cover.css('display') != "none") { $cover.remove(); }
    });
};

var constructAndDisplay = function () {
    var start = '<ul>'
    $.each(mainstore, function (i, element) {
        var item = '<li><b>' + element[0] + ' : </b><span>' + element[1] + '</span></li>';
        start = start + item;

    })
    start = start + '</ul>';
    popAlert('header', start);
};
var Buildview = function (title, valuee) { mainstore.push([title, JSON.stringify(valuee)]) };
/// <reference path="jquery-1.6.4.js" />


Ceyword.CmenuHandler(function (cdiv, sArray, cBackFn) {
    var mainstore = [];    
    sArray = ["edit", "cut", "copy", "paste", "delete", "select all", "---------", "quit"]
    var constructAndDisplay = function (x, y, wrapper) {
        var start = '<ul id ="menu" style="position:absolute; left:' + x + 'px; top:' + y + 'px; height:210px; width:120px;">'
        $.each(mainstore, function (i, element) {
            var item = '<li><b>' + element[0] + '</b><span>';
            start = start + item;
        })
        start = start + '</ul>';
        popAlert(start, wrapper);
    };
    var Buildview = function (value) { mainstore.push([value]) };
    var popAlert = function (msg, wrapper) {
        $container = $('#' + wrapper);
        if ($container.css('z-index') === "auto") { zindex = 150; }
        else { zindex = $container.css('z-index') + 1; }
        $container.append(msg);
        $("#menu").menu(); //creates the menu
        $('.ui-menu-item').bind('click', function (e) {
            cBackFn(this.textContent);
            $('.ui-menu-item').unbind('click', function (e) { });
            $("#menu").menu("destroy");
            $("#menu").children().remove();
            $("#menu").remove();
            mainstore = [];
        });

    };
    var deletemenu = function (relX, relY, wrapperid) {
        $("#menu").menu("destroy");//Removes the menu functionality completely.
        $("#menu").children().remove();
        $("#menu").remove();
        mainstore = [];//empty menu store
        addmenu(relX, relY, wrapperid);
    }
    var addmenu = function (relX, relY, wrapperid) {     
        for (i = 0; i < sArray.length; i++) {
            Buildview(sArray[i]);//Build the menu items
        }
        //here you draw your own menu
        constructAndDisplay(relX, relY, wrapperid);

    }
    if (document.getElementById($cdiv.id).addEventListener) {//Trigger that constructs the Contextmenu object
        document.getElementById($cdiv.id).addEventListener('contextmenu', function (e) {
            var wrapper = this;            
            var wrapperid = this.id;
            var relX = e.pageX - wrapper.offsetLeft + wrapper.scrollLeft;
            var relY = e.pageY - wrapper.offsetTop + wrapper.scrollTop;
            ($('#menu').length > 0) ? deletemenu(relX, relY, wrapperid) : addmenu(relX, relY, wrapperid)            
            e.preventDefault();
        }, false);
    } else {
        
    }    
});
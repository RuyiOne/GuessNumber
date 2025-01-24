/// <reference path="jquery-1.9.0.min.js" />

PlayerOne = new Object();
PlayerTwo = new Object();
var isComputer = false;
var computerGuess;
var aiGuesses = [];
var num = "";
var store = "";
var count = 0;
var counter;
var dead = 0;
var k = 1;
var p = "";
var q = "";
var number;
var wounded = 0;
var table;
var x;
var xCount, yCount;
var y;
var z;
var initiator;
var tcount = 0;

ChannelName = new Object();
UserId = new Object();
$(window).ready(function () {        
    $('.nmb').attr('disabled', 'disabled');
    $('#start').attr('hidden', 'hidden');    
    $('#end').click(function () {
        
        var msg = $(this).val().toLowerCase();            
        window.hubReady.done(function () {
            guessHub.server.choice(msg, ChannelName.name, PlayerOne.name);
        });
    });
    $('#restart').click(function () {
        var msg = $(this).val().toLowerCase();
        window.hubReady.done(function () {
            guessHub.server.choice(msg, ChannelName.name, PlayerOne.name);
        });
    });   
    $('#pause').click(function () {
        var msg = $(this).val().toLowerCase();
        window.hubReady.done(function () {
            guessHub.server.choice(msg, ChannelName.name, PlayerOne.name);
        });
    });
    $('#tchoice').click(function () {
        if ($(this).is(':checked')) {
            $('#game').append('<span id="ttime"></span>');
        }
    });
    $('#Enter').click(function () {              
        var check = userData();        
        (check === true) ? $('#diva').attr('style', 'display:block;') : showDiv();
    });
    $('#numb').change(function () {        
        displayNumber();
    });
    $('.nmb').click(function () {
        var index = (this.id);
        
        switch(index)
        {
            case "guess": guessNumber(); 
                break;
            case "clear": clearNumber(index);
                break;
            default: displayNumber(index);
                break;
        }
       
    });
    $('#play').click(function () {
        setupSignalR();
        $('#Enter').removeAttr('disabled');
        $('#myleft').attr('style', 'display:none;');
        $('#diva').attr('style', 'display:block;');
    });    
    $('#start').click(function () {
                  
                   
    });
    $('#smsg').click(function () {
        var msg = $('#pmsg').val().toLowerCase();
        $('#game').append('<li> You said:' + msg + '</li>');
        $('#pmsg').val("");
        window.hubReady.done(function () {
            guessHub.server.passMessage(msg, ChannelName.name);
        });
    });
    $('#ail').click(function () {        
        PlayerTwo.name = "Computer";
        computerGuess = makeAIGuess();
        console.log("cg = " + computerGuess);
        var firstguess = makeAIGuess();        
        var f = evaluateGuess(firstguess, computerGuess)
        filterAIPossibleNumbers(f, firstguess);
        console.log("hi arrived here 2");
        store = firstguess;
        dead = f.dead;
        wounded = f.wounded;
        
        //insCell();
        isComputer = true;
        initiator = true;
        $('#userinfo').find('#avail').remove('#avail');
        $('#userinfo').find('.userdata').remove();
        $('#userinfo').html('');
        $('#userinfo').append('<h2 class= "sub-header">Profile</h2>');
        var xx = '<div class="table-responsive" style="width:300px;"><table class="table table-striped">';
        xx = xx + '<tr><td><ul><img src="pix/you.jpg" style="height:75px; width 75px;"></ul></td><table style="margin-top: -85px;margin-left: 150px;"><tr><td>' + PlayerOne.name + '</td></tr><tr><td>6 Wins</td></tr></table>';
        xx = xx + '<table><tr><td><ul style="height:25px; width 75px; text-align:center; margin-top:50px; margin-left:75px;">Vs.</ul></td></tr></table>';
        xx = xx + '<tr><td><ul><img src="pix/mimi.jpg" style="height:75px; width 75px; margin-top:0px; margin-left:5px;"></ul></td><table style="margin-top: -75px;margin-left: 150px;"><tr><td>' + PlayerTwo.name + '</td></tr><tr><td>6 Wins</td></tr></table>';
        //x = x + '<tr><td></td><td></td></tr>';
        xx = xx + '</table></div>';
        $('#userinfo').append(xx);
        //$('#start').removeAttr('hidden');
        if (initiator) {
            console.log("initiator");
            $('.nmb').removeAttr('disabled');
            $('#details').text('Your turn.');
        }
        else {
            $('#details').text(PlayerTwo.name + "'s turn.");
        }
        $('#numb').val('');
        //$('#userinfo').append(PlayerOne.name + ' vs ' + PlayerTwo.name); 
        setTimeout(function () {
            $('#mybody').fadeOut(2000);
            $('#mybody').attr('style', 'display:none;')
            $('#console').attr('style', 'display:block; margin-top:0px;');
            var xx = '<tr><th align="center">';
            xx = xx + PlayerOne.name.toString();
            xx = xx + '</th><th align="center" >';
            xx = xx + PlayerTwo.name;
            xx = xx + '</th></tr>';
            console.log(xx);
            $('#result').append(xx);

        }, 5000);
    });
});

var stopSignalR = function () {
    window.hubstop = $.connection.hub.stop();
    return window.hubstop;
};

function showDiv() {
    $('#diva').attr('style', 'display:none;');
    $('#mybody').attr('style', 'display:block;');
}

function test() {
    console.log("yeap");
}

function userData() {
    var check;
    p = $('#name').val().toString();
    q = $('#number').val().toString();   
    var t;
    var ch = [0, 0, 0, 0];
    
    PlayerOne.name = p.toString();
    
    PlayerOne.number = q.toString(10).split("");
    
    //Number check
    var k = 0;
        var arr = ['0'];
        var are = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    
        for (var i = 0; i < (PlayerOne.number).length; i++) {
            
            if (PlayerOne.number[i] === arr[0])
            { t = 1;}
            for (var j = 0; j < 9; j++) {
                if (PlayerOne.number[i] === are[j]) { (ch[j])++;}
            }
        }
        for (var ii = 0; ii < 9; ii++) {
            if (ch[ii] > 1) { t = 1; }
        }    
    
    if (t) {
        console.log('invalid number, your number may contain a 0 or has a value repeated');
        $('#errdetail').text('Invalid number, your number contains a 0 or has a value repeated.');
        check = true;
    }
    else {        
        $('#Enter').attr('disabled','disabled')
        check = passNumber();
        
    }
    return check;
}

function passNumber(check) {
    switch ((PlayerOne.number).length) {
        case 4: saveMyConnectionId(PlayerOne.name);
            break;
        default: console.log('check to see your number has four digits correct'); $('#errdetail').text('check to see your number has four digits correct'); $('#Enter').removeAttr('disabled');
            return true;
            
    }
    
}

function displayNumber(val) {    
    if (count <= 3) {
        $('#numb').val( $('#numb').val().toString() + val);
        store = $('#numb').val().toString(10).split("");
        count++;
    }
    else {
        console.log("Your guess can have a maximum length of 4 only. Click Guess to continue, OR  Click Clear to change number"); $('#details').text("Your guess can have a maximum length of 4 only. Click Guess to continue, OR  Click Clear to change number");
        
    }
}

function clearNumber() {
    $('#numb').val("");
    count = 0;    
}

function guessNumber() {
    console.log("isComputer" + isComputer);
    console.log(store);
    //var dnum = number.toString(10).split(".");

    if (store.length < 4) {
        console.log("the length of your guess is faulty please enter valid guess"); 
        $('#details').text("the length of your guess is faulty please enter valid guess"); 
        
    }
    else {

        for (var i = 0; i < 4; i++) {

            for (var j = 0; j < 4; j++) {
                if (i - 1 === j) {null }
                else {
                    if (store[i - 1] === store[j]) {
                        console.log("Please enter a valid number; numbers with repeated digits are not allowed");
                        $('#details').text("Please enter a valid number; numbers with repeated digits are not allowed");

                        i = 4;
                    }
                }
            }
            if (i === 3) {
                $('#numb').val('');
                var gnum = "";
                
                for (var k = 0; k < 4; k++) {
                    gnum = gnum + store[k];
                };
                store = gnum
                clearNumber();
                if (isComputer === false) {
                    window.hubReady.done(function () { guessHub.server.passNumber(ChannelName.name, gnum, "guess"); });
                }
                else { comparenumbers(gnum); }
                
               
            }
        }
    }
    
    
}

function insCell() {
    var ff = 'r' + tcount;
    table = document.getElementById("tab");
    //$("#tab").attr("style", "text-align:center;");
    var gg = '<tr id="' + ff + '"><td class="first" style="width:50%;"></td><td class="second" style="width:50%;"></td></tr>';
    
    if (yCount === 0) {
        if (initiator) {
            console.log('initiator = true and Second column');
            var bb =  store + '-' + dead + "d " + wounded + "w";
            $('#' + ff).children('.second').append(bb);
            //$('#' + ff).append(bb);
            tcount++;
        }
        else {
            console.log('initiator = false and first column');
            var bbb = store + '-' + dead + "d " + wounded + "w";
            //$('#' + ff).find('td')[1]
            //var bb = '<td>' + wounded + "w" + dead + "d " + store + ' ' + '</td>';
            $('#' + ff).children('.first').append(bbb);
            //$('#' + ff).append(bb);
            tcount++;
        }
        yCount = counter;
    }

    else {

        if (initiator) {
            console.log('initiator = true and first column');
            var abb = store + '-' + dead + "d " + wounded + "w";
            $("#result").append(gg);            
            //$('#' + ff).append(bb);
            $('#' + ff).children('.first').append(abb);
        }
        else {
            console.log('initiator = false and Second column');
            var cbb = store + '-' + dead + "d " + wounded + "w";
            //var bb = '<td>' + wounded + "w" + dead + "d " + store + ' ' + '</td>';
            $("#result").append(gg);
            //$("#tab").attr("dir", "rtl");
            //$('#' + ff).append(bb);  
            $('#' + ff).children('.second').append(cbb);
        }
        yCount = 0;
    }
    


        //if (yCount === 0) {
        //    y = x.insertCell(x.cells.length);
        //    y.width = 50;
        //    y.innerHTML = store +' ' + dead + "d " + wounded + "w";
        //    yCount = counter;
        //}
        //else {
        //    xCount = table.rows.length;
        //    x = table.insertRow(xCount);
        //    yCount = x.cells.length;
        //    y = x.insertCell(yCount);
        //    y.width = 50;
        //    y.innerHTML = store + ' ' + dead + "d " + wounded + "w";
        //}
        
    
    }


var guessHubNotifs = function () {
    guessHub.client.receiveBroadcast = function (id) {
        return id;
    };
    guessHub.client.receiveMessage = function (msg) {
        $('#game').append('<li>'+ PlayerTwo.name + ' says:'  + msg + '</li>');
    };
    guessHub.client.inviteReply = function (msg) {
        return (msg);
    };
    guessHub.client.channel = function (ch) {
        return (ch);
    };
    guessHub.client.iAmConnected = function (id) {
        
    };
    guessHub.client.viewAllNames = function (id) {        
    };    
    guessHub.client.receiveName = function (name, id) {
        $('#userinfo').append('<a id = ' + id + ' class = "userdata" href = "#">' + name + '</a><br />');
        var b = "#" + id;        
        $(b).off('click', function (e) { });
        $(b).one('click', function (e) {  choice(id); });
    };
    guessHub.client.removeId = function (id) {
        var b = ("'#" + id + "'")
        var c = $('#userinfo').find(b);
        c.next().remove()        
        $('#userinfo').find(b).remove(b);      
    };
    guessHub.client.receiveInvite = function (id) {
        var b = "#" + id;
        var i = confirm(($(b).html()) + ' has invited you for a game of guess numbers. Do you want to play against ' + $(b).html() + '?')
        switch (i) {
            case true: //$('.nmb').removeAttr('disabled');
                PlayerTwo.name = $(b).html();
                UserId.id = id;                
                //$('#numb1').val(PlayerOne.name);
                //$('#numb2').val(PlayerTwo.name);
                
                var xx = '<tr><th>';
                xx = xx + PlayerOne.name.toString();
                
                xx = xx + '</th><th>';
                xx = xx + PlayerTwo.name;
                xx = xx + '</th></tr>';
                console.log(xx);
                $('#result').append(xx);
                ChannelName.offer = i;                             
                window.hubReady.done(function () { guessHub.server.passReply(id, i.toString()); });
                break;
            case false: ChannelName.offer = i;               
                window.hubReady.done(function () { guessHub.server.passReply(id, null); });
                break;
        }
    };    
    guessHub.client.receiveToken = function (channel) {
        ChannelName.name = channel;        
        $('#start').removeAttr('hidden');
        window.hubReady.done(function () { guessHub.server.useForPassReply(channel); });        
    };
    guessHub.client.coolStore = function (id) {
        UserId.id = id;
        var b = '#'+ id ;
        PlayerTwo.name = $(b).html();
        
        //$('#numb1').val(PlayerOne.name);
        //$('#numb2').val(PlayerTwo.name);
        var xx = '<tr><th align="center">';
        xx = xx + PlayerOne.name.toString();        
        xx = xx + '</th><th align="center" >';
        xx = xx + PlayerTwo.name;
        xx = xx + '</th></tr>';
        console.log(xx);
        $('#result').append(xx);
        //$('#console').attr('style', 'display:block;');
    };
    guessHub.client.getNumber = function (dnum, type) {
        console.log(type)

        switch (type) {
            case "guess": comparenumbers(dnum);
                break;
            case "answer": reply(dnum);
                break;
        }
    };
    guessHub.client.rejection = function () {
        console.log(1)
    };
    guessHub.client.fail = function (e) {
        console.log(e)
    };
    guessHub.client.accept = function () {
        $('#userinfo').find('#avail').remove('#avail');
        $('#userinfo').find('.userdata').remove();
        $('#userinfo').html('');
        $('#userinfo').append('<h2 class= "sub-header">Profile</h2>');
        var xx = '<div class="table-responsive" style="width:300px;"><table class="table table-striped">';
        xx = xx + '<tr><td><ul><img src="pix/you.jpg" style="height:75px; width 75px;"></ul></td><table style="margin-top: -85px;margin-left: 150px;"><tr><td>' + PlayerOne.name + '</td></tr><tr><td>6 Wins</td></tr></table>';
        xx = xx + '<table><tr><td><ul style="height:25px; width 75px; text-align:center; margin-top:50px; margin-left:75px;">Vs.</ul></td></tr></table>';
        xx = xx + '<tr><td><ul><img src="pix/mimi.jpg" style="height:75px; width 75px; margin-top:0px; margin-left:5px;"></ul></td><table style="margin-top: -75px;margin-left: 150px;"><tr><td>' + PlayerTwo.name + '</td></tr><tr><td>6 Wins</td></tr></table>';
        //x = x + '<tr><td></td><td></td></tr>';
        xx = xx + '</table></div>';
        $('#userinfo').append(xx);
        //$('#start').removeAttr('hidden');
        if (initiator) {
            console.log("initiator");
            $('.nmb').removeAttr('disabled');
            $('#details').text('Your turn.');
        }
        else {
            $('#details').text(PlayerTwo.name + "'s turn.");
        }
        $('#numb').val('');
        //$('#userinfo').append(PlayerOne.name + ' vs ' + PlayerTwo.name); 
        setTimeout(function () {
            $('#mybody').fadeOut(2000);
            $('#mybody').attr('style', 'display:none;')
            $('#console').attr('style', 'display:block; margin-top:0px;');

        }, 5000);
    };
    guessHub.client.gameaction = function (n, e) {
        console.log(e);
        $('#details').text("");
        switch(e)
        {
            case "end": $('#details').append(n + " has quit the game. Do you want to choose another opponent? <a id='ryes'>yes</a>&nbsp;&nbsp;<a id='rno'>no</a>");
                
                $('#rno').on('click', function () {
                    $('#rno').off('click', function () { });
                    window.hubReady.done(function () {
                        //guessHub.server.choice($(this).val().toLowerCase(), ChannelName.name, PlayerOne.name);
                    });
                });
                $('#ryes').on('click', function () {
                    $('#ryes').off('click', function () { });
                    window.hubReady.done(function () {
                        //guessHub.server.choice($(this).val().toLowerCase(), ChannelName.name, PlayerOne.name);
                    });
                });
            //case "restart": $('#details').text(n + " has asked to restart the game. Click ok to confirm."); ;
                //    break;
                break;
            case "pause": $('#details').append(n + " has asked to pause the game.");
                break;
            case "replay": $('#details').append(n + " has asked for a replay of this game. Do you accept? <a id='ryes'>yes</a>&nbsp;&nbsp;<a id='rno'>no</a>");
                
                $('#rno').on('click', function () {
                    $('#rno').off('click', function () { });
                    window.hubReady.done(function () {
                        guessHub.server.choice($(this).val().toLowerCase(), ChannelName.name, PlayerOne.name);
                    });
                });
                $('#ryes').on('click', function () {
                    $('#ryes').off('click', function () { });
                    window.hubReady.done(function () {
                        guessHub.server.choice($(this).val().toLowerCase(), ChannelName.name, PlayerOne.name);
                    });
                });
                break;

        }
    };
};
var setupSignalR = function () {
    guessHub = $.connection.guessHub;
    $.connection.hub.logging = true;
    guessHubNotifs();
    window.hubReady = $.connection.hub.start().done(function () { console.log("Connected"); }).fail(function () { console.log("Could not Connect!"); });
    
};
var saveMyConnectionId = function (val) {
   
    window.hubReady.done(function () {
        guessHub.server.saveMyConnectionId(val.toString());
    });
};
var getConnectionIds = function () {
    window.hubReady.done(function () {
        videoChat.server.getAllNames();
    });
};
var choice = function (e) {
    var b = "#" + e
    var i = confirm('You have asked to play a game of guess numbers with ' + $(b).html());
    switch (i) {
        case true: passId(e);
            break;        
    }
}
var passId = function (e) {
    initiator = true;
    window.hubReady.done(function () { guessHub.server.passId((e)); });
};
var reply = function (dnum) {    
    dead = 0;
    wounded = 0;
    dnum = dnum.toString(10).split("");    
    dead = dnum[0];
    wounded = dnum[1];
    insCell();
    console.log(dead);
    $('.nmb').attr('disabled', 'disabled');
    if (parseInt(dead) === 4) {
        $('#details').text( "You have won the Game. Congratulations!!!");
    }
    else {

        $('#details').text(PlayerTwo.name + "'s Turn.");
    }
    store = ""; wounded = 0; dead = 0;
};
var comparenumbers = function (dnum) {
    store = dnum;    
    dnum = dnum.toString(10).split("");    
    for (var k = 0; k < 4; k++) {
        if (dnum[k] === PlayerOne.number[k]) { dead++; }

        for (var l = 0; l < 4; l++) {
            if (k === l) { null}
            else { if (dnum[l] === PlayerOne.number[k]) { wounded++; } }
        }
    }
    var t = dead.toString() + wounded.toString();
    insCell();
    console.log(dead);
    
    if (parseInt(dead) === 4) {
        $('#details').text("You have lost this time around to " + PlayerTwo.name + ". " + PlayerTwo.name + "'s number is " + store + '. Better luck next time.');
    }
    else {
        $('.nmb').removeAttr('disabled');
        $('#details').text('Your Turn.');
    }
    store = ""; wounded = 0; dead = 0;
    if (isComputer === false) {
        window.hubReady.done(function () { guessHub.server.passNumber(ChannelName.name, t, "answer"); });
    }
    else{}
    
};
var getUniqueNumbers = function() {
    let numbers = [];
    for (let i = 1234; i <= 9876; i++) {
        let numStr = i.toString();
        let digits = new Set(numStr);
        if (digits.size === 4 && !numStr.includes('0')) { // Check if all digits are unique
            numbers.push(i);
        }
    }
    return numbers;
}
var filterAIPossibleNumbers = function(feedback, guess) {
    this.possibleNumbers = this.possibleNumbers.filter(num => {
        let evaluation = this.evaluateGuess(num, guess);
        return evaluation.dead === feedback.dead && evaluation.wounded === feedback.wounded;
    });
    console.log(`After filtering, ${this.possibleNumbers.length} possible numbers remain.`);    
    console.log(this.possibleNumbers);
}

var makeAIGuess = function () {
    let guess;    
    do {
        guess = this.possibleNumbers[Math.floor(Math.random() * this.possibleNumbers.length)];
        console.log(guess);
    } while (aiGuesses.indexOf(guess) !== -1);

    aiGuesses.push(guess); // Track AI's guess to avoid duplication
    return guess;
}

var evaluateGuess = function(guess, secret) {
    let dead = 0, wounded = 0;
    let matchedInSecret = new Array(4).fill(false);
    let matchedInGuess = new Array(4).fill(false);

    // Count 'dead' (correct digit and position)
    for (let i = 0; i < 4; i++) {
        if (guess[i] === secret[i]) {
            dead++;
            matchedInSecret[i] = true;
            matchedInGuess[i] = true;
        }
    }

    // Count 'wounded' (correct digit but wrong position)
    for (let i = 0; i < 4; i++) {
        if (!matchedInGuess[i]) {
            for (let j = 0; j < 4; j++) {
                if (!matchedInSecret[j] && guess[i] === secret[j]) {
                    wounded++;
                    matchedInSecret[j] = true;
                    matchedInGuess[i] = true;
                    break;
                }
            }
        }
    }

    return { dead, wounded };
}
var possibleNumbers = getUniqueNumbers();



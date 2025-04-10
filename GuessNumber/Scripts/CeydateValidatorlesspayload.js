/// <reference path="jquery-1.6.4.min.js" />
$errholder = [];

var dayHandler = function (d, m, y) {
    var dte = new Date(Date.now());    
    if (y === parseInt(dte.getFullYear())) {        
        if (m === parseInt(dte.getMonth()+1, 10)) {            
            if (d > parseInt(dte.getDate(), 10)) return [false, "Invalid Day specified, Day cannot exceed today"]
        }
    }
        switch (m){
            case 2:
                if ((y%4)==0){
                    if(d<0 || d>29) return [false, "Invalid day specified, day can only range from 1-29 in a leap year February by the Gregorian calendar"]; 
                    else return [true];
                }
                else if ((y%4)!=0) 
                {
                    if(d<0 || d>28) return [false, "Invalid day specified, day can only range from 1-28 in a non-leap year February by the Gregorian calendar"]; 
                    else return [true];
                }
                break;
            case 4:               
            case 6:               
            case 9:               
            case 11:
                if(d<0 || d>30) return [false, errHandler(m)]; 
                else return [true];
                break;
            default:
                if(d<0 || d>31) return [false, errHandler(m)]; 
                else return [true];
                break;
        }
    }
var mthHandler = function (m, y) {
           var dte = new Date(Date.now());
           if (y == dte.getFullYear()) {
               if (m > dte.getMonth() + 1) return [false, "Invalid Month specified, Month cannot exceed current month"]
           }
        if (m<1 || m>12) return [false, "Invalid Month specified, Month can only range from 1-12 by the Gregorian calendar"];            
        else return [true];
    } 
    var yrHandler = function (y) {
        var dte = new Date(Date.now());        
        if (y<0 || y>parseInt(dte.getFullYear(), 10)) return [false, "Invalid Year specified, Year can only range from 0 - "+ dte.getFullYear() + " by the Gregorian calendar"];
        else return [true];
    }
    var errHandler = function(m){
        var mnth = ['January', 'February', 'March', 'April', 'May', 'June',	'July', 'August', 'September', 'October', 'November', 'December'];
        return "Invalid day specified, day can only range from 1-30 in " + mnth[m - 1] + " by the Gregorian calendar";
    }    
    var DValidator = function (_d, _m, _y) {
        var msg, comp = function (_d, _m, _y) {
            var msg, result, d = dayHandler(_d, _m, _y), m = mthHandler(_m, _y), y = yrHandler(_y);
            if (!d[0]) { result = d } else if (!m[0]) { result = d } else if (!y[0]) { result = d } else { result = [true] }; return result
        };
        if (!day) { msg = 'Enter Valid Day' } else if (!month) { msg = 'Enter Valid Month' } else if (!year) { msg = 'Enter Valid Year' };
        return (msg ? [false, msg] : comp(day, month, year))
    };
    
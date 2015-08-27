Based on https://github.com/lifeemotions/knx.net

Right now it not tested in all directions, but KnxConnectionTunneling is working.
One can find Usage example, it tested with KNXnet/IP router: ABB IPR/S 2.1.
 
#Usage

```
var KnxConnectionTunneling = require('knx.js').KnxConnectionTunneling;
var connection = new KnxConnectionTunneling('192.168.2.222', 3671, '192.168.2.107', 13671);

var lightValue = false;
function toggleLight() {
    lightValue = !lightValue;
    connection.Action("1/0/0", lightValue);
}

connection.Connect(function () {
    setTimeout(toggleLight, 2000);
    setTimeout(toggleLight, 5000);
    setTimeout(function () {
        connection.Disconnect();
    }, 7000);
});



```
 
# License

![Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)](https://licensebuttons.net/l/by-nc-sa/4.0/88x31.png "CC BY-NC-SA 4.0")
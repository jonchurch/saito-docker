
function clickHandler(e) {
  chrome.runtime.sendMessage({directive: "popup-click"}, function(response) {
    this.close(); // close the popup when the background finishes processing request
  });
}

function updateServer(e) {

  var serverhost = document.getElementById('serverhost').value;
  var serverport = document.getElementById('serverport').value;

  chrome.runtime.sendMessage({directive: "update_server" , "serverhost" : serverhost, "serverport" : serverport}, function(response) {
    console.log("message has been send in popup");
    this.close(); // close the popup when the background finishes processing request
  });

}


document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('click-me').addEventListener('click', clickHandler);
    document.getElementById('update_server').addEventListener('click', updateServer);
});




chrome.storage.local.get(["options"], function(items){
  if (items != null) {
    if (items.options != null) {
console.log("1111");
      showMenu();
    } else {
console.log("1112");
      showStart();
    }
  } else {
console.log("1113");
    showStart();
  }
});

function showMenu() {
  document.getElementById("menu").style.visibility = "visible";
  document.getElementById("start").style.visibility = "hidden";
  document.getElementById("start").style.display = "none";
  document.getElementById("menu").style.display = "all";
}

function showStart() {
  document.getElementById("menu").style.visibility = "hidden";
  document.getElementById("menu").style.display = "none";
  document.getElementById("start").style.visibility = "visible";
  document.getElementById("start").style.display = "all";
}




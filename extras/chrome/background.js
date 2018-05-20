
console.log("HERE WE ARE");

  chrome.runtime.onMessage.addListener(
    function(message, callback) {
      if (message == "runContentScript"){
        chrome.tabs.executeScript({
          file: 'contentScript.js'
        });
      }
   });


chrome.webRequest.onBeforeRequest.addListener(
    function() {
        return {cancel: true};
    },
    {
        urls: ["http://localhost:12101/*rowser.j*"]
    },
    ["blocking"]
);




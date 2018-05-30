var saito = require('../../../saito');
var ModTemplate = require('../../template');
var util = require('util');


//////////////////
// CONSTRUCTOR  //
//////////////////
function Chat(app) {

  if (!(this instanceof Chat)) { return new Chat(app); }

  Chat.super_.call(this);

  this.app             = app;

  this.name            = "Chat";
  this.browser_active  = 0;
  this.handlesEmail    = 1;
  this.emailAppName    = "Chatorization";

  this.sessions        = {};

  return this;

}
module.exports = Chat;
util.inherits(Chat, ModTemplate);

Chat.prototype.initialize = function initialize(app) {

  if (app.BROWSER == 0) { return; }



  // remove us if mobile client is running
  if ($('#Chat_browser_active').length == 0) {
    for (var t = app.modules.mods.length-1; t >= 0; t--) {
      if (app.modules.mods[t].name == "ChatMobile") {
        app.modules.mods.splice(t, 1);
      }
    }
  }

}

/////////////////////////
// Handle Web Requests //
/////////////////////////
Chat.prototype.webServer = function webServer(app, expressapp) {
  expressapp.get('/chat/', function (req, res) {
    res.sendFile(__dirname + '/web/index.html');
    return;
  });
  expressapp.get('/chat/script.js', function (req, res) {
    res.sendFile(__dirname + '/web/script.js');
    return;
  });
  expressapp.get('/chat/style.css', function (req, res) {
    res.sendFile(__dirname + '/web/style.css');
    return;
  });

}

Chat.prototype.initializeHTML = function initialize(app) {

  var chat_self = this;

  // update wallet balance
  // this.updateBalance(app);

  // tell the browser what our public/private keys look like
  // $('#lightbox_viewkeys_publickey').html(app.wallet.returnPublicKey());
  // $('#lightbox_viewkeys_privatekey').html(app.wallet.returnPrivateKey());

  // 1. Who do I want to talk to
  // Find Users that I know about
  // var chat_sessions = this.app.keys.returnKeysByTag("Chat");

  // save information to the options locally

  // once you have your keys, you want to add them as peers

  var publicKey = app.wallet.returnPublicKey()
  var privateKey = app.wallet.returnPrivateKey()

  var rooms = ['All', 'David', 'Richard', 'Jack']

  for (room in rooms) {
    $('.chatRoomSelector').append(`<option value="${room}">${room}</option>`)
    this.sessions[room] = {}
  }

  this.sessions['All'].push({author: "BearGuy", message: "Welcome to Saito!"})

  // saito.wallet.createUnsignedTransaction(to_pubkey)

  // Core Functions to utilize
  // findKeyByTag
  // TODO: findKeysByTags
  // find vs return, any difference??

  // encrypt, facebook, reddit, remix
  // returnWatchedPublicKeys
  // saito.keys.addKey
  // Saving important key data to options
  // host and port saved in key data?
  // Once you have determined your keys, add them as peers

  // 1. Who do i want to talk to --> Facebook example
  // 2. Add Peers from keys
  // 3. Generate Shared Secret
  // 4. How do I let my peers know --> host and port in keys

  // Chat rooms, specify are you server??
  // Edit Key class to contain host and port (optional)
  // --> Broadcast message to inform change of IP

  // On itiliazation, make a local copy of the keys you want to manage

  // 5. How to send chat message
  // --> wallet --> createUnsignedTransaction(fee=0.0)
  // --> peer --> handlePeerRequest
  // things are not encrypted unless the module does it
  // Peer protocol will be defined in the module --> message.reqeust

  // Chain functionality can handle certain use cases
  // --> Persistence
  // --> Broadcast
  // Both exist if the module can't directly connect to the peer

  // fetch data from app
  // var tmptx = new saito.transaction();
  //     tmptx.transaction.id          = 0;
  //     tmptx.transaction.ts          = new Date().getTime();
  //     tmptx.transaction.from        = [];
  //     tmptx.transaction.from[0]     = {};
  //     tmptx.transaction.from[0].add = "bearguy@saito";
  //     tmptx.transaction.msg         = {};
  //     tmptx.transaction.msg.module  = "Chat";
  //     tmptx.transaction.msg.title   = "Welcome to the Saito Network (click here)";
  //     tmptx.transaction.msg.markdown = 0;
  //     tmptx.transaction.msg.message    = 'Welcome to Saito Chat! This is a decentralized chat system';
  // tmptx.decrypted_msg = tmptx.transaction.msg;
  // chat_self.addMessageToInbox(tmptx, app);


  // Run on the client, not on the server
  // msg = {};
  // msg.id     = "0";
  // msg.time   = new Date().getTime();
  // msg.from   = "david@saito";
  // msg.module = "Chat";
  // msg.title  = "Welcome to Saito Chat!";
  // msg.data   = "Greetings from the Saito team, Welcome to Saito chat! Feel free to try it out and message peers in which you have keys for";
  // this.attachMessage(msg, app, 1);
  // app.wallet.createUnsignedTransactionWithDefaultFee(to, amount)


  // load archived messages
  app.archives.processTransactions(20, function (err, txarray) {
    for (var bv = 0; bv < txarray.length; bv++) {
      try {
        if (txarray[bv].transaction.msg.module == "Chat") { //|| txarray[bv].transaction.msg.module == "Encrypt") {
          chat_self.addMessageToSession(txarray[bv], app);
        }
      } catch (err) {
        console.log("ERRR: ");
        console.log(err);
      }
    }
  });

}

Chat.prototype.handlePeerRequest = function handlePeerRequest(app, req, peer, mycallback) {
  if (req.request === "chat send message") {

    if (req.data.tx == null) { console.log("ERROR -- data tx not defined"); return; }

    let counter = req.data.counter;

    if (counter == 0) {
      var newreq = {}
      newreq.request = "chat send message"
      newreq.data = {};
      newreq.data.tx = req.data.tx
      newreq.data.counter = 1

      app.network.sendRequest(newreq.request, newreq.data);
    }
    if (counter == 1 && app.BROWSER == 1) {
      let tmptx = JSON.parse(req.data.tx);
      this.attachMessage(tmptx, app);
    }
  }
}

Chat.prototype.formatMessage = function formatMessage({id, author, message}){
  return `
  <p id="#message_id_${id}" class="message">
    <i>${author}</i>: ${message}
  </p>
  `
}

Chat.prototype.attachMessage = function attachMessage(tx, app) {
  $('.messages-list').append(this.formatMessage(tx.transaction.msg));

  this.attachEvents(app);
}

Chat.prototype.attachEvents = function attachEvents(app) {

  var chat_self = this;

  $('.new-message-input').off();
  $('.new-message-input').on('keypress', function(e) {
    if (e.which == 13 || e.keyCode == 13) {
      msg = $('.new-message-input').val();

      if (msg == '') { return }

      var newtx = app.wallet.createUnsignedTransaction(app.wallet.returnPublicKey(), 0.0, 0.0);
      if (newtx == null) { return; }

      newtx.transaction.msg.module = "Chat";
      //newtx.transaction.msg.id = `#message_id_${chat_self.messageCounter}`;
      newtx.transaction.msg.author = "BearGuy";
      newtx.transaction.msg.message = msg;
      newtx = app.wallet.signTransaction(newtx);
      newtx.transaction.msg.id = newtx.transaction.sig;

      var req = {}
      req.request = "chat send message"
      req.data = {};
      req.data.tx = JSON.stringify(newtx)
      req.data.counter = 0

      app.network.sendRequest(req.request, req.data);
      //chat_self.messageCounter++;
      $('.new-message-input').val('');

      // app.network.propagateTransaction(newtx);
      // app.storage.saveOptions();
    }
  });
}

Chat.prototype.isPublicKey = function isPublicKey(publickey) {
  if (publickey.length == 44 || publickey.length == 45) {
    if (publickey.indexOf("@") > 0) {} else {
      return 1;
    }
  }
  return 0;
}
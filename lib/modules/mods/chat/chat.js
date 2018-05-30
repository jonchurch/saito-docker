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
  this.chat            = this.app.options.chat || {};

  return this;

}
module.exports = Chat;
util.inherits(Chat, ModTemplate);




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


Chat.prototype.initializeHTML = function initializeHTML(app) {

  var chat_self = this

  // load archived messages
  app.archives.processTransactions(30, function (err, txarray) {
    if (txarray.length != 0){
      for (let bv = 0; bv < txarray.length; bv++) {
        try {
          console.log(txarray[bv].transaction);
          if (txarray[bv].transaction == [] || txarray[bv].transaction == null) { return; }

          var {msg, sig} = txarray[bv].transaction;
          if (msg.module == "Chat") { //|| txarray[bv].transaction.msg.module == "Encrypt") {

            var { author, message, chatRoom } = msg;
            var newmsg = { id: sig, author, message };

            if (chat_self.chat[chatRoom] == null) {
              chat_self.chat[chatRoom] = [newmsg];
            } else {
              chat_self.chat[chatRoom].push(newmsg);
            }
          }
        } catch (err) {
          console.log("ERRR: ");
          console.log(err);
        }
      }
      chat_self.chat.All.unshift({ author: "BearGuy", message: "Welcome to Saito!" })
    } else {
      chat_self.chat.All = [{ author: "BearGuy", message: "Welcome to Saito!" }]
    }
    chat_self.renderMessagesToDOM('All');
  });

  if (chat_self.chat['All'].length == 1) {
    var rooms = ['All', 'Richard', 'David', 'Jack']
    for (i in rooms) {
      $('.chat-room-selector')
        .append(`<option class="chat-room-option" value="${rooms[i]}">${rooms[i]}</option>`)
      chat_self.chat[rooms[i]] = []
    }
  } else {
    for (i in chat_self.chat) {
      $('.chat-room-selector')
        .append(`<option class="chat-room-option" value="${i}">${i}</option>`)
    }
  }

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

      //newreq.data.relay = 1;
      // for relay, need onChainTransaction
      // newreq.data.recipient = PUBLICKEY ?


      app.network.sendRequest(newreq.request, newreq.data);
    }
    if (counter == 1 && app.BROWSER == 1) {
      let tmptx = JSON.parse(req.data.tx);
      this.attachMessage(tmptx, app);
    }
  }

  if (req.request === "chat add user") {
    if (req.data.tx == null) { console.log("ERROR -- data tx not defined"); return; }

    let counter = req.data.counter;

    if (counter == 0) {
      var newreq = {}
      newreq.request = "chat add user"
      newreq.data = {};
      newreq.data.tx = req.data.tx
      newreq.data.counter = 1
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
  var { msg, sig }                  = tx.transaction;
  var { author, message, chatRoom } = msg;

  var newmsg = { id: sig, author, message };

  this.chat[chatRoom].push(newmsg);


  var messageList = $(`.messages-list#${chatRoom}`)

  if (messageList.length != 0) { messageList.append(this.formatMessage(newmsg)); }

  this.attachEvents(app);
}

Chat.prototype.renderMessagesToDOM = function renderMessagesToDOM(chatRoomValue){
  var chat_self = this;

  var messageListParent = $('.messages-list').parent();

  $('.messages-list').remove()

  var messageList = $(`<ul class="messages-list" id=${chatRoomValue}></ul>`);

  chat_self.chat[chatRoomValue].forEach(function(message){
    messageList.append(chat_self.formatMessage(message));
  })

  // console.log(value);
  messageListParent.append(messageList);
}

Chat.prototype.onConfirmation = function onConfirmation(blk, tx, conf, app) {
  if (conf == 0) {
    if (tx.transactions.to[0].add == app.wallet.returnPublicKey()) {

      let reply_needed = 0;
      let reply_port = "";
      let reply_host = "";
      let reply_pubkey = "";
      let reply_relay = 0;

      if (tx.transaction.msg.counter == 0) { reply_needed = 1; }

      // browser
      if (app.BROWSER == 1) {
        reply_relay = 1;

        // FIXME: assume the first peer is going to be the connected server
        var { host, port, publickey } = this.app.options.peers[0]
        reply_host = this.app.options.peers[0].host
        reply_port = this.app.options.peers[0].port
        reply_pubkey = this.app.options.peers[0].pubkey

        this.app.options.peers.push(this.chat)

      // server
      } else {
        var serverPublicKey = this.app.server.returnPublicKey();

        var { host, port } = tx.transaction.msg

        this.app.options.chat.user.push({ host, port, publickey: tx.transaction.from[0].add});
        this.app.storage.saveOptions();

        app.network.propagateTransaction(newtx);
      }

      if (reply_needed == 1) {

        // i need to send a message
        var newtx = app.wallet.createUnsignedTransactionWithDefaultFee(app.wallet.returnPublicKey())
        newtx.transaction.msg.module = "Chat";
        newtx.transaction.msg.counter = 0
        newtx.transaction.msg.relay = 1
        // newtx.transaction.msg.relay_pubkey
        newtx.transaction.msg.host = this.app.options.host
        newtx.transaction.msg.port = this.app.options.port
        newtx = app.wallet.signTransaction(newtx);

      }
    }
  }
}

Chat.prototype.attachEvents = function attachEvents(app) {

  var chat_self = this;

  $('.new-message-input').off();
  $('.new-message-input').on('keypress', function(e) {
    if (e.which == 13 || e.keyCode == 13) {


// check if add messqge and if... {

  // create "chat add user"
  // create tx
  // tell them ... relay = 1/0
  // tell them how to connect
  // server --> send port or IP address
  // if (app.BROWSER == 1) {  ----> send the server I'm connected o... } options.server

  // onConfirmation --> save information to the keys and whatever private data storage you have for chat
  //return; }

      console.log(JSON.stringify(chat_self.chat, null, 4));
      var msg = $('.new-message-input').val();
      var chatRoom = $('.chat-room-selector').val();

      if (msg == '') { return }

      if (msg == "chat add user") {
        var newtx = app.wallet.createUnsignedTransactionWithDefaultFee(app.wallet.returnPublicKey())
        newtx.transaction.msg.module = "Chat";
        newtx.transaction.msg.counter = 0
        newtx.transaction.msg.relay = 1
        // newtx.transaction.msg.relay_pubkey
        newtx.transaction.msg.host = this.app.options.host
        newtx.transaction.msg.port = this.app.options.port
        newtx = app.wallet.signTransaction(newtx);

        // var req = {}
        // req.request = msg
        // req.data = {};
        // req.data.tx = JSON.stringify(newtx)
        // req.data.                // has it made contact with the server yet?
        // req.data.relay = 1
        // req.data.pubkey = app.wallet.returnPublicKey()

        app.network.propagateTransaction(newtx);
        // app.network.sendRequest(req.request, req.data);
      }

      var newtx = app.wallet.createUnsignedTransaction(app.wallet.returnPublicKey(), 0.0, 0.0);
      if (newtx == null) { return; }

      newtx.transaction.msg.module = "Chat";
      newtx.transaction.msg.author = "BearGuy";
      newtx.transaction.msg.message = msg;
      newtx.transaction.msg.chatRoom = chatRoom;
      newtx = app.wallet.signTransaction(newtx);

      var req = {}
      req.request = "chat send message"
      req.data = {};
      req.data.tx = JSON.stringify(newtx)
      req.data.counter = 0

      app.network.sendRequest(req.request, req.data);

      $('.new-message-input').val('');

      // app.network.propagateTransaction(newtx);
      // app.archives.saveOptions();
      app.archives.saveTransaction(newtx);
    }
  });

  $('.chat-room-selector').change(function(){
    chat_self.renderMessagesToDOM($(this).val());
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




Chat.prototype.saveChat = function saveChat() {
  this.app.options.chat = this.chat;
  this.app.storage.saveOptions();
}


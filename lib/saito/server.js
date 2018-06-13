const saito        = require('../saito');
const net          = require('net');
const http         = require('http');
const util         = require('util');
const fs           = require('fs');
const path         = require('path');


/////////////////
// Constructor //
/////////////////
function Server(app) {

  if (!(this instanceof Server)) {
    return new Server(app);
  }

  this.app               = app || {};

  this.blocks_dir        = path.join(__dirname, '../data/blocks/');
  this.server            = {};
  this.server.host       = "";
  this.server.port       = 0;
  this.server.publickey  = "";

  this.endpoint          = {};
  this.endpoint.host     = "";
  this.endpoint.port     = "";
  this.endpoint.protocol = "";

  this.webserver         = null;
  this.io                = null;

  return this;

}
module.exports = Server;



////////////////
// initialize //
////////////////
//
// this function creates the server that will feed 
// out our HTML files. It then passes control to 
// all of its installed modules, which can affix 
// their own content to the web-server.
//
Server.prototype.initialize = function initialize() {

  if (this.app.BROWSER == 1) { return; }

  var server_self = this;


  // initialize endpoint
  // if (this.app.options.endpoint != null) {
  //   console.log("We get initialized!", this.app.options.endpoint);
  //   server_self.endpoint.port = this.app.options.endpoint.port;
  //   server_self.endpoint.host = this.app.options.endpoint.host;
  //   server_self.endpoint.protocol = this.app.options.endpoint.protocol;
  // } else {
  //   server_self.app.options.endpoint = server_self.endpoint;
  //   server_self.app.storage.saveOptions();
  // }


  this.server.publickey = this.app.wallet.returnPublicKey();

  //
  // update server information from options file
  //
  if (this.app.options.server != null) {
    this.server.host = this.app.options.server.host;
    this.server.port = this.app.options.server.port;
  }
  if (this.server.host == "" || this.server.port == 0) {
    console.log("Not starting local server as no hostname / port in options file");
    return;
  }
  //
  // write server info to options file
  //
  if (this.app.options.server == null) {
    this.app.options.server = this.server;
  }

  //
  // save options
  //
  this.app.storage.saveOptions();

  const app 	   = require('express')();
  const fileUpload = require('express-fileupload');
  const webserver  = require('http').Server(app);
  const io 	   = require('socket.io')(webserver);
  const bodyParser = require('body-parser');

  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(fileUpload());

  ////////////
  // blocks //
  ////////////
  app.get('/blocks/:blockhash', function (req, res) {
    var blkh = req.params.blockhash;
    try {
      // if block is in mempool, serve mempool
      for (let mtp = 0; mtp < server_self.app.mempool.blocks.length; mtp++) {
        let tmpblk = server_self.app.mempool.blocks[mtp];

        if (tmpblk.returnHash() == blkh) {
          let blk2send = JSON.stringify(tmpblk.block).toString('utf8');

          res.write(blk2send);
          res.end();

          return;
        }
      }

      server_self.app.blockchain.returnBlockByHash(blkh, function(blk) {
        if (blk == null) { return; }

        if (blk.filename != "") {
          let blkfilename = server_self.blocks_dir + blk.filename;

          res.sendFile(blkfilename);
          return;
        } else {
          let blk2send = JSON.stringify(blk.block).toString('utf8');

          res.write(blk2send);
          res.end();

          return;
        }

        if (mycallback != null) { mycallback(); }

      });

    } catch (err) {
      console.log("FAILED REQUEST: could not find block "+blkh);
    }
  });


  /////////////////////////
  // general web content //
  /////////////////////////
  app.all('/', function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");
    next();
  });
  app.get('/', function (req, res) {
    res.sendFile(__dirname + '/web/index.html');
    return;
  });
  app.get('/style.css', function (req, res) {
    res.sendFile(__dirname + '/web/style.css');
    return;
  });
  app.get('/browser.js', function (req, res) {

    //
    // may be useful in the future, if we gzip
    // files before releasing for production
    //
    // gzipped, cached -- if you enable cached 
    // and gzipped, be sure to manually edit the 
    // content-length to reflect the size of the 
    // file
    //
    //res.setHeader("Cache-Control", "public");
    //res.setHeader("Content-Encoding", "gzip");
    //res.setHeader("Content-Length", "368432");
    //res.sendFile(__dirname + '/web/browser.js.gz');
    //

    // non-gzipped, non-cached
    res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");
    res.setHeader("expires","-1");
    res.setHeader("pragma","no-cache");
    res.sendFile(__dirname + '/web/browser.js');
    return;
  });
  app.get('/client.options', function (req, res) {
    server_self.app.storage.saveClientOptions();
    res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");
    res.setHeader("expires","-1");
    res.setHeader("pragma","no-cache");
    res.sendFile(__dirname + '/web/client.options');
    return;
  });

  app.get('/img/:imagefile', function (req, res) {
    var imgf = '/web/img/'+req.params.imagefile;
    if (imgf.indexOf("\/") != false) { return; }
    res.sendFile(__dirname + imgf);
    return;
  });
  app.get('/img/graphs/:imagefile', function (req, res) {
    var imgf = '/web/img/graphs/'+req.params.imagefile;
    if (imgf.indexOf("\/") != false) { return; }
    res.sendFile(__dirname + imgf);
    return;
  });
  app.get('/docs/:basefile', function (req, res) {
    var imgf = '/web/docs/'+req.params.basefile;
    if (imgf.indexOf("\/") != false) { return; }
    res.sendFile(__dirname + imgf);
    return;
  });
  app.get('/jquery/:basefile', function (req, res) {
    var imgf = '/web/lib/jquery/'+req.params.basefile;
    if (imgf.indexOf("\/") != false) { return; }
    res.sendFile(__dirname + imgf);
    return;
  });
  app.get('/qrcode/:basefile', function (req, res) {
    var imgf = '/web/lib/qrcode/'+req.params.basefile;
    if (imgf.indexOf("\/") != false) { return; }
    res.sendFile(__dirname + imgf);
    return;
  });
  app.get('/fancybox/:filename', function (req, res) {
    var imgf = '/web/lib/fancybox/'+req.params.filename;
    if (imgf.indexOf("\/") != false) { return; }
    res.sendFile(__dirname + imgf);
    return;
  });
  app.get('/font-awesome/css/:filename', function (req, res) {
    var imgf = '/web/lib/font-awesome/css/'+req.params.filename;
    if (imgf.indexOf("\/") != false) { return; }
    res.sendFile(__dirname + imgf);
    return;
  });
  app.get('/font-awesome/fonts/:filename', function (req, res) {
    var imgf = '/web/lib/font-awesome/fonts/'+req.params.filename;
    if (imgf.indexOf("\/") != false) { return; }
    res.sendFile(__dirname + imgf);
    return;
  });


  /////////////////
  // module data //
  /////////////////
  this.app.modules.webServer(app);

  webserver.listen(this.server.port);

  this.webServer = webserver;

  // update network
  io.on('connection', function (socket) {
    server_self.app.network.addPeerWithSocket(socket);
  });

}

Server.prototype.close = function close() {
  this.webServer.close();
}

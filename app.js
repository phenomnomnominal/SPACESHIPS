'use strict';

var express = require('express.io');
var Quadtree = require('./quadtree');
var Scores = require('./scores');
var app = express();
app.http().io();

app.use(express.static(__dirname + '/static'));

var consts = {
  fps: 60,
  shipSize: 36,
  width: 700,
  height: 960,
  bulletSize: 7
};

var players = {};
var scores = new Scores();
var bullets = [];
var debug = false;

['reset', 'leave'].forEach(function (e) {
  app.io.route(e, function (req) {
    req.io.broadcast(e, req.data);
  });
});

app.io.route('join', function(req) {
  req.io.broadcast('join', req.data);
  players[req.data.name] = req.data;
  scores.addPlayer(req.data.name);
  req.io.emit('score', scores.toSortedArray());
  req.io.broadcast('score', scores.toSortedArray());
});

app.io.route('heartbeat', function(req) {
  req.io.broadcast('heartbeat', req.data);
  players[req.data.name] = req.data;

  if (req.data.exploded) { return; }

  // Collision check
  Object.keys(players).forEach(function(key) {
    if (key === req.data.name) { return; }
    var otherPlayer = players[key];
    if (otherPlayer.exploded) { return; }
    var x = otherPlayer.x - req.data.x,
        y = otherPlayer.y - req.data.y,
        distance = Math.sqrt(x*x + y*y);
    if (distance <= consts.shipSize) {
      console.log(req.data.name, ' collided with ', key);
      otherPlayer.exploded = true;
      players[req.data.name].exploded = true;
      app.io.broadcast('exploded', {
        name: key
      });
      app.io.broadcast('exploded', {
        name: req.data.name
      });
    }
  });
});

app.io.route('fire', function (req) {
  bullets.push(req.data);
  req.io.broadcast('fire', req.data);
});

app.io.route('debug-init', function() {
  debug = true;
});
app.io.route('debug-fire-10', function(req) {
  if (!debug) { return; }
  for (var i = 0; i < 10; i++) {
    bullets.push(req.data);
  }
});

var tickLengthMs = 1000 / consts.fps;

var previousTick = Date.now();
var actualTicks = 0;
var tickCollection = [];

var gameLoop = function () {
  var now = Date.now();
  actualTicks++;

  if (previousTick + tickLengthMs <= now) {
    var delta = (now - previousTick) / 1000;
    previousTick = now;

    var quadtree = new Quadtree({
      x: 0,
      y: 0,
      width: consts.width,
      height: consts.height
    }, bullets.length + Object.keys(players).length + 5);  // Fudge factor
    bullets = bullets.map(function (bullet) {
      bullet.x += bullet.dx;
      bullet.y += bullet.dy;
      bullet.life -= bullet.decay;
      return bullet;
    }).filter(function (bullet) {
      return bullet && bullet.life > 0;
    });
    bullets.forEach(function(bullet) {
      quadtree.insert({
        x: bullet.x,
        y: bullet.y,
        width: consts.bulletSize,
        height: consts.bulletSize,
        owner: bullet.owner
      });
    });

    Object.keys(players).forEach(function(playerKey) {
      var player = players[playerKey];
      if (player.exploded) { return; }
      var possibleHits = quadtree.retrieve({
        x: player.x,
        y: player.y,
        width: consts.playerSize,
        height: consts.playerSize
      });


      var hit, x, y, distance;
      for (var i = 0, len = possibleHits.length; i < len; i++) {
        if (possibleHits[i].owner === playerKey) { continue; }
        x = player.x - possibleHits[i].x;
        y = player.y - possibleHits[i].y;
        distance = Math.sqrt(x*x + y*y);
        if (distance <= consts.bulletSize/2 + consts.shipSize/2) {
          hit = possibleHits[i];
          break;
        }
      }

      if (hit) {
        console.log(playerKey, 'was hit', hit);
        scores.scorePoint(hit.owner);
        console.log(scores.toSortedArray());
        app.io.broadcast('score', scores.toSortedArray());
        app.io.broadcast('exploded', {
          name: playerKey
        });
      }
    });

    if (debug) {
      tickCollection.push(actualTicks);
      if (tickCollection.length === consts.fps) {
        var sum = tickCollection.reduce(function(old, cur) {
          return old + cur;
        }, 0);
        console.log('tick average', sum / consts.fps);
        console.log(bullets.length);
        app.io.broadcast('debug-update', {
          tickAverage: sum / consts.fps,
          bullets: bullets.length
        });
        tickCollection = [];
      }
    }
    actualTicks = 0;
  }

  if (Date.now() - previousTick < tickLengthMs - 16) {
    setTimeout(gameLoop);
  } else {
    setImmediate(gameLoop);
  }
};

gameLoop();

app.listen(process.env.PORT || 8080);

console.log('running');
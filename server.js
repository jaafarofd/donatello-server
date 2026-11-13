'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const PORT = Number(process.env.PORT || 8080);
const SECRET = process.env.AUTH_SECRET;
if (!SECRET || SECRET.length < 32) { console.error('Set AUTH_SECRET (at least 32 characters)'); process.exit(1); }
const MAX_ROOMS = 100, MAX_CHAT = 500, MAX_MEMBERS = 16;
const clients = new Map(), rooms = new Map(), bans = new Map(), invites = new Map();
const safe = s => String(s || '').slice(0, 80);
const send = (ws, type, data={}) => { if(ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({type,...data})); };
const broadcast = (targets,type,data) => { for(const id of targets) send(clients.get(id)?.ws,type,data); };
const publicUser = u => ({id:u.id,name:u.name,role:u.role,room:u.room,spectating:u.spectating});
const roomInfo = r => ({id:r.id,name:r.name,host:r.host,players:[...r.players],spectators:[...r.spectators],capacity:r.capacity});
const listRooms = () => [...rooms.values()].map(roomInfo);
function verify(token){
  if(typeof token !== 'string' || token.length > 4096) return null;
  const parts=token.split('.'); if(parts.length!==2)return null;
  const sig=crypto.createHmac('sha256',SECRET).update(parts[0]).digest('base64url');
  const a=Buffer.from(sig), b=Buffer.from(parts[1]);
  if(a.length!==b.length || !crypto.timingSafeEqual(a,b))return null;
  try { const p=JSON.parse(Buffer.from(parts[0],'base64url').toString());
    if(!p.id || !p.name || !Number.isFinite(p.exp) || p.exp<Date.now()/1000 || !['user','mod','admin'].includes(p.role))return null;
    return {id:String(p.id).slice(0,80),name:safe(p.name),role:p.role};
  }catch{return null;}
}
function emitRooms(){for(const u of clients.values())send(u.ws,'rooms',{rooms:listRooms()});}
function leave(u){if(!u.room)return;const r=rooms.get(u.room);u.room=null;u.spectating=false;if(!r)return;r.players.delete(u.id);r.spectators.delete(u.id);if(!r.players.size&&!r.spectators.size)rooms.delete(r.id);else {if(r.host===u.id)r.host=[...r.players,...r.spectators][0];broadcast(new Set([...r.players,...r.spectators]),'room_updated',{room:roomInfo(r)});}emitRooms();}
function join(u,r,spectate=false){if(!r)return send(u.ws,'error',{message:'Room not found'});if(bans.get(u.id)?.has(r.id))return send(u.ws,'error',{message:'Banned from room'});if(!spectate && r.players.size>=r.capacity)return send(u.ws,'error',{message:'Room full'});leave(u);u.room=r.id;u.spectating=!!spectate;(spectate?r.spectators:r.players).add(u.id);send(u.ws,'joined',{room:roomInfo(r),spectating:u.spectating});broadcast(new Set([...r.players,...r.spectators]),'room_updated',{room:roomInfo(r)});emitRooms();}
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true,users:clients.size,rooms:rooms.size}));}
 if(pathname==='/' || pathname==='/index.html') {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return fs.createReadStream(path.join(__dirname,'public/index.html')).pipe(res);}
 res.writeHead(404);res.end('Not found');
});
const wss=new WebSocketServer({server,maxPayload:8192});
wss.on('connection',(ws)=>{
 let u=null, hits=[];
 const reject=(message)=>send(ws,'error',{message});
 ws.on('message',buf=>{
  const now=Date.now();hits=hits.filter(t=>now-t<10000);hits.push(now);if(hits.length>40)return ws.close(1008,'Rate limit');
  let m;try{m=JSON.parse(buf.toString())}catch{return reject('Invalid JSON')};if(!m||typeof m.type!=='string')return reject('Missing type');
  if(!u){if(m.type!=='auth')return reject('Authenticate first');const p=verify(m.token);if(!p)return ws.close(1008,'Invalid token');if(clients.has(p.id))clients.get(p.id).ws.close(1008,'New session');u={...p,ws,room:null,spectating:false};clients.set(u.id,u);send(ws,'welcome',{user:publicUser(u),rooms:listRooms(),online:clients.size});return;}
  const txt=typeof m.text==='string'?m.text.trim().slice(0,MAX_CHAT):'';
  const r=u.room?rooms.get(u.room):null;
  switch(m.type){
   case 'list':send(ws,'rooms',{rooms:listRooms()});break;
   case 'create':if(rooms.size>=MAX_ROOMS)return reject('Room limit');{const id=crypto.randomUUID();const name=safe(m.name||'Room');const room={id,name,host:u.id,capacity:Math.max(2,Math.min(MAX_MEMBERS,Number(m.capacity)||8)),players:new Set(),spectators:new Set()};rooms.set(id,room);join(u,room);}break;
   case 'join':join(u,rooms.get(String(m.roomId)),false);break;
   case 'spectate':join(u,rooms.get(String(m.roomId)),true);break;
   case 'leave':leave(u);send(ws,'left');break;
   case 'chat':if(u.mutedUntil && u.mutedUntil>now)return reject('Muted');if(!txt)return; if(m.scope==='lobby'){broadcast(clients.keys(),'chat',{scope:'lobby',from:publicUser(u),text:txt});}else if(r){broadcast(new Set([...r.players,...r.spectators]),'chat',{scope:'room',roomId:r.id,from:publicUser(u),text:txt});}else reject('Join a room');break;
   case 'private':if(!txt)return;{const other=clients.get(String(m.to));if(!other)return reject('User offline');send(other.ws,'private',{from:publicUser(u),text:txt});send(ws,'private_sent',{to:other.id,text:txt});}break;
   case 'invite':{const other=clients.get(String(m.to));if(!r||!other)return reject('Room or recipient unavailable');const code=crypto.randomBytes(12).toString('hex');invites.set(code,{roomId:r.id,to:other.id,exp:now+60000});send(other.ws,'invite',{from:publicUser(u),room:roomInfo(r),code});send(ws,'invite_sent',{to:other.id});}break;
   case 'accept_invite':{const code=String(m.code);const inv=invites.get(code);invites.delete(code);if(!inv||inv.to!==u.id||inv.exp<now)return reject('Invalid invitation');join(u,rooms.get(inv.roomId));}break;
   case 'kick':case 'ban':case 'mute':{
    if(!r)return reject('Join a room');if(u.role==='user'&&r.host!==u.id)return reject('Not authorized');const target=clients.get(String(m.to));if(!target||target.room!==r.id)return reject('Target not in room');if(target.id===u.id)return reject('Cannot moderate yourself');if(target.role==='admin'&&u.role!=='admin')return reject('Not authorized');
    if(m.type==='mute'){target.mutedUntil=now+Math.min(3600000,Math.max(1000,Number(m.durationMs)||60000));send(target.ws,'moderated',{action:'mute',until:target.mutedUntil});}
    else {if(m.type==='ban'){if(!bans.has(target.id))bans.set(target.id,new Set());bans.get(target.id).add(r.id);}send(target.ws,'moderated',{action:m.type,roomId:r.id});leave(target);}
    send(ws,'moderation_ok',{action:m.type,to:target.id});break;
   }
   default:reject('Unknown type');
  }
 });
 ws.on('close',()=>{if(u&&clients.get(u.id)?.ws===ws){leave(u);clients.delete(u.id);}});
});
// Guard muted users before chat dispatch: chat checks below via handler precondition.
server.listen(PORT,()=>console.log('Donatello listening on '+PORT));

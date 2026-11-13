// Development/testing only. In production, PHP must issue tokens after verifying login.
const crypto=require('crypto');
const secret=process.env.AUTH_SECRET;
if(!secret||secret.length<32)throw Error('AUTH_SECRET must be at least 32 chars');
const [id,name,role='user']=process.argv.slice(2);
if(!id||!name||!['user','mod','admin'].includes(role))throw Error('Usage: node make-token.js id name [user|mod|admin]');
const payload=Buffer.from(JSON.stringify({id,name,role,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
console.log(payload+'.'+crypto.createHmac('sha256',secret).update(payload).digest('base64url'));

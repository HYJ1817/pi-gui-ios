import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { REMOTE_V1, authorizePairExchange, buildPairProofMessage, buildSignatureMessage, validateEventEnvelope, validatePairExchange, validatePairExchangeResponse, validateRemoteRequest, validateRemoteResponse, verifyPairExchangeProof, verifyPairExchangeResponse, verifyRemoteSignature } from '../scripts/lib/remote-protocol-contract.mjs';

const id='4b1f3561-33e1-4aa1-8a54-8dc176cd5367';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function testKeyPair() {
  const pair=generateKeyPairSync('ed25519');
  const spki=pair.publicKey.export({type:'spki',format:'der'});
  const raw=spki.subarray(spki.length-32);
  return {...pair,publicKeyRaw:raw.toString('base64url')};
}
function canonicalJson(value) {
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function headersFor(rawBody,requestId=id) {
  return {
    'x-pi-remote-device':'device_abc12345',
    'x-pi-remote-request-id':requestId,
    'x-pi-remote-timestamp':'1795273200000',
    'x-pi-remote-nonce':Buffer.alloc(32,8).toString('base64url'),
    'x-pi-remote-signature':Buffer.alloc(64,9).toString('base64url'),
    'x-pi-remote-body-sha256':hash(rawBody),
    'accept':'application/json',
  };
}
function signedRequest(unsigned,keyPair,nonce=Buffer.alloc(32,7).toString('base64url'),timestamp=Date.now().toString()) {
  const deviceId='device_abc12345';
  const requestId=unsigned.body?.requestId ?? id;
  const bodyBytes=Buffer.from(unsigned.rawBody ?? '', 'utf8');
  const bodySha256=hash(bodyBytes);
  const message=buildSignatureMessage({protocolVersion:1,requestId,method:unsigned.method,path:unsigned.path,query:unsigned.query??{},timestamp,nonce,bodySha256});
  const signature=sign(null,Buffer.from(message,'utf8'),keyPair.privateKey).toString('base64url');
  const headers={
    'x-pi-remote-device':deviceId,
    'x-pi-remote-request-id':requestId,
    'x-pi-remote-timestamp':timestamp,
    'x-pi-remote-nonce':nonce,
    'x-pi-remote-body-sha256':bodySha256,
    'x-pi-remote-signature':signature,
    'accept':'application/json',
    'content-type':'application/json; charset=utf-8',
  };
  return {...unsigned,headers,remoteDeviceId:deviceId,devicePublicKey:keyPair.publicKeyRaw};
}
function request(operation,path,payload={},extra={}) {
  const method=extra.method??REMOTE_V1.operations.find(x=>x.id===operation).method;
  const body=method==='GET'?undefined:{protocolVersion:1,operation,payload,...(extra.ownerRevision===undefined?{}:{ownerRevision:extra.ownerRevision})};
  const rawBody=body===undefined?'':canonicalJson(body);
  return {method,path,headers:{...headersFor(rawBody),'accept':'application/json',...(method==='GET'?{}:{'content-type':'application/json; charset=utf-8'})},rawBody,...(body===undefined?{}:{body}),...(extra.query===undefined?{}:{query:extra.query})};
}
function replaceBody(base,body) {
  const rawBody=canonicalJson(body);
  return {...base,headers:{...base.headers,'x-pi-remote-body-sha256':hash(rawBody)},rawBody,body};
}

test('remote v1 contract is explicitly draft, HTTPS-only and disabled by default',()=>{
  assert.equal(REMOTE_V1.contractVersion,1);
  assert.equal(REMOTE_V1.status,'design-contract');
  assert.equal(REMOTE_V1.transport.scheme,'https');
  assert.equal(REMOTE_V1.transport.defaultEnabled,false);
  assert.equal(REMOTE_V1.transport.existingLocalApiForwarding,false);
  assert.deepEqual(REMOTE_V1.transport.pairing.defaultScopes,['projects.read','sessions.read']);
  assert.equal(REMOTE_V1.scopeVocabulary.includes('approvals.read'),true);
  assert.equal(REMOTE_V1.operations.find(x=>x.id==='approvals.list').scope,'approvals.read');
  assert.equal(REMOTE_V1.transport.pairing.singleUse,true);
  assert.equal(REMOTE_V1.transport.pairing.attemptWindowSeconds,600);
  assert.equal(REMOTE_V1.signedRequest.algorithm,'Ed25519');
  assert.match(REMOTE_V1.signedRequest.validationNote,/Gateway must independently enforce TLS/);
});

test('operation ids, scopes and methods are unique and closed',()=>{
  const ids=REMOTE_V1.operations.map(x=>x.id);
  assert.equal(new Set(ids).size,ids.length);
  assert.equal(new Set(REMOTE_V1.scopeVocabulary).size,REMOTE_V1.scopeVocabulary.length);
  for (const op of REMOTE_V1.operations) {
    assert.ok(['GET','POST'].includes(op.method));
    assert.ok(REMOTE_V1.scopeVocabulary.includes(op.scope));
    assert.ok(op.path.startsWith('/remote/v1/'));
    assert.equal(op.path.includes('*'),false);
    assert.ok(op.result && op.result.type==='object' && op.result.additionalProperties===false);
  }
  assert.deepEqual(REMOTE_V1.forbiddenCapabilities,['generic-rpc','shell','terminal','filesystem','arbitrary-path','provider-credentials','raw-desktop-token','arbitrary-url-proxy','public-relay']);
});

test('pair exchange accepts only a short-lived-code payload shape',()=>{
  const validBody={pairingSessionId:Buffer.alloc(16,3).toString('base64url'),pairCode:'042817',deviceName:'Test iPhone',devicePublicKey:'P'.repeat(43),clientNonce:'N'.repeat(43),serviceFingerprint:'a'.repeat(64),proofSignature:'p'.repeat(86)};
  const valid={method:'POST',path:'/remote/v1/pair/exchange',headers:{'content-type':'application/json; charset=utf-8','accept':'application/json'},rawBody:canonicalJson(validBody),body:validBody};
  assert.deepEqual(validatePairExchange(valid),{ok:true,code:'pair_shape_valid'});
  for (const patch of [
    {pairCode:'42817'},
    {pairCode:'042817',unexpected:'field'},
    {pairCode:'042817',deviceName:'',devicePublicKey:'P'.repeat(43),clientNonce:'N'.repeat(43),serviceFingerprint:'a'.repeat(64),proofSignature:'p'.repeat(86)},
    {pairCode:'042817',deviceName:'Phone',devicePublicKey:'P'.repeat(43),clientNonce:'N'.repeat(43),serviceFingerprint:'a'.repeat(64),proofSignature:'p'.repeat(86),token:'secret'},
    {pairCode:'042817',deviceName:'Phone',devicePublicKey:'P'.repeat(48),clientNonce:'N'.repeat(43),serviceFingerprint:'a'.repeat(64),proofSignature:'p'.repeat(86)},
  ]) { const body={...valid.body,...patch}; assert.equal(validatePairExchange({...valid,body,rawBody:canonicalJson(body)}).ok,false); }
  assert.equal(validatePairExchange({...valid,path:'/api/command'}).ok,false);

  const pairResponse={deviceId:'device_12345678',serverNonce:Buffer.alloc(32,4).toString('base64url'),grantedScopes:['projects.read','sessions.read'],expiresAt:'2026-11-21T15:00:00Z',serverSignature:Buffer.alloc(64,5).toString('base64url')};
  assert.equal(validatePairExchangeResponse(pairResponse),true);
  assert.equal(validatePairExchangeResponse({...pairResponse,grantedScopes:['projects.read','projects.read']}),false);
  assert.equal(validatePairExchangeResponse({...pairResponse,accessToken:'secret'}),false);
});

test('project and session reads accept only opaque ids and empty payloads',()=>{
  assert.equal(validateRemoteRequest(request('projects.list','/remote/v1/projects')).ok,true);
  const sessions=request('sessions.list','/remote/v1/projects/project_12345678/sessions');
  assert.equal(validateRemoteRequest(sessions).ok,true);
  assert.equal(validateRemoteRequest({...sessions,path:'/remote/v1/projects/../sessions'}).ok,false);
  assert.equal(validateRemoteRequest({...sessions,path:'/remote/v1/projects/%2fetc/sessions'}).ok,false);
});

test('runtime creation requires a revision and does not allow classic cwd/path fields',()=>{
  const base=request('runtime.create','/remote/v1/projects/project_12345678/conversations',{clientConversationId:id},{ownerRevision:2});
  assert.equal(validateRemoteRequest(base).ok,true);
  assert.equal(validateRemoteRequest(request('runtime.create','/remote/v1/projects/project_12345678/conversations',{clientConversationId:id})).code,'owner_revision_required');
  assert.equal(validateRemoteRequest(replaceBody(base,{...base.body,payload:{clientConversationId:id,cwd:'C:/secret'}})).ok,false);
});

test('chat send is bounded, revision-bound and not a command proxy',()=>{
  const base=request('chat.send','/remote/v1/conversations/conversation_12345678/messages',{clientMessageId:id,text:'hello'},{ownerRevision:3});
  assert.equal(validateRemoteRequest(base).ok,true);
  assert.equal(validateRemoteRequest(replaceBody(base,{...base.body,payload:{...base.body.payload,text:'x'.repeat(100001)}})).ok,false);
  assert.equal(validateRemoteRequest(replaceBody(base,{...base.body,payload:{...base.body.payload,command:'rm -rf'}})).ok,false);
  assert.equal(validateRemoteRequest(replaceBody(base,{...base.body,payload:{...base.body.payload,access_token:'marker'}})).ok,false);
  assert.equal(validateRemoteRequest({...base,headers:{...base.headers,'x-pi-gui-token':'marker'}}).code,'signature_headers_invalid');
  assert.equal(validateRemoteRequest(replaceBody(base,{...base.body,operation:'rpc.call'})).code,'envelope_invalid');
});

test('exact signed body bytes and parsed request body must agree',()=>{
  const base=request('chat.send','/remote/v1/conversations/conversation_12345678/messages',{clientMessageId:id,text:'hello'},{ownerRevision:3});
  assert.equal(validateRemoteRequest({...base,rawBody:base.rawBody+' '}).code,'body_parse_mismatch');
  assert.equal(validateRemoteRequest({...base,headers:{...base.headers,'x-pi-remote-body-sha256':'0'.repeat(64)}}).code,'signature_headers_invalid');
  assert.equal(validateRemoteRequest({...base,body:{...base.body,payload:{clientMessageId:id,text:'different'}}}).code,'body_parse_mismatch');
});

test('stop uses a typed operation and requires current owner revision',()=>{
  const base=request('chat.stop','/remote/v1/conversations/conversation_12345678/stop',{}, {ownerRevision:4});
  assert.equal(validateRemoteRequest(base).ok,true);
  assert.equal(validateRemoteRequest(request('chat.stop','/remote/v1/conversations/conversation_12345678/stop')).code,'owner_revision_required');
});

test('approval response is bound to a real opaque request id and closed method/decision',()=>{
  const base=request('approvals.respond',`/remote/v1/conversations/conversation_12345678/approvals/${id}/respond`,{method:'confirm',decision:'deny'},{ownerRevision:5});
  assert.equal(validateRemoteRequest(base).ok,true);
  assert.equal(validateRemoteRequest(replaceBody(base,{...base.body,payload:{method:'confirm',decision:'allow',always:true}})).ok,false);
  assert.equal(validateRemoteRequest(replaceBody(base,{...base.body,payload:{method:'unknown',decision:'allow'}})).ok,false);
});

test('signature canonicalization binds protocol, request identity, path/query, timestamp, nonce and body digest',()=>{
  const fields={protocolVersion:1,requestId:id,method:'get',path:'/remote/v1/events',query:{z:'last value',cursor:'a/b'},timestamp:'1795273200000',nonce:'n'.repeat(43),bodySha256:hash('')};
  const expected=['1',id,'GET','/remote/v1/events?cursor=a%2Fb&z=last%20value','1795273200000','n'.repeat(43),hash('')].join('\n');
  assert.equal(buildSignatureMessage(fields),expected);
  assert.equal(buildSignatureMessage({...fields,query:{cursor:'a/b',z:'last value'}}),expected);
  assert.equal(buildSignatureMessage({...fields,query:{cursor:1}}),null);
});
test('Ed25519 request signature, skew and atomic replay gate are exercised with synthetic keys',()=>{
  const pair=testKeyPair();
  const unsigned=request('chat.send','/remote/v1/conversations/conversation_12345678/messages',{clientMessageId:id,text:'synthetic only'},{ownerRevision:7});
  const timestamp=Date.now().toString();
  const nonce=Buffer.alloc(32,9).toString('base64url');
  const valid=signedRequest(unsigned,pair,nonce,timestamp);
  let consumed=0;
  const consumeNonce=(device,seenNonce,at)=>{assert.equal(device,'device_abc12345');assert.equal(seenNonce,nonce);assert.equal(at,Number(timestamp));consumed++;return consumed===1;};
  const verification={request:valid,devicePublicKey:pair.publicKeyRaw,registeredDeviceId:'device_abc12345',grantedScopes:['chat.send'],nowMs:Number(timestamp),consumeNonce};
  const first=verifyRemoteSignature(verification);
  assert.equal(first.ok,true); assert.equal(first.operation,'chat.send'); assert.equal(first.scope,'chat.send'); assert.equal(first.deviceId,'device_abc12345'); assert.equal(consumed,1);
  assert.equal(verifyRemoteSignature(verification).code,'request_replayed');
  assert.equal(verifyRemoteSignature({...verification,nowMs:Number(timestamp)+61000,consumeNonce:()=>true}).code,'signature_expired');
  assert.equal(verifyRemoteSignature({...verification,consumeNonce:undefined}).code,'replay_store_unavailable');
  assert.equal(verifyRemoteSignature({...verification,devicePublicKey:testKeyPair().publicKeyRaw,consumeNonce:()=>true}).code,'signature_invalid');
  assert.equal(verifyRemoteSignature({...verification,registeredDeviceId:'another_device'}).code,'device_identity_mismatch');
  assert.equal(verifyRemoteSignature({...verification,grantedScopes:['projects.read']}).code,'scope_denied');
});

test('pair proof binds code, displayed name, device key, nonce and service fingerprint',()=>{
  const pair=testKeyPair(),fingerprint=hash('synthetic desktop certificate');
  const body={pairingSessionId:Buffer.alloc(16,3).toString('base64url'),pairCode:'042817',deviceName:'Synthetic iPhone',devicePublicKey:pair.publicKeyRaw,clientNonce:Buffer.alloc(32,5).toString('base64url'),serviceFingerprint:fingerprint};
  const proof=sign(null,Buffer.from(buildPairProofMessage(body),'utf8'),pair.privateKey).toString('base64url');
  const request={method:'POST',path:REMOTE_V1.pairExchange.path,headers:{'content-type':'application/json; charset=utf-8','accept':'application/json'},body:{...body,proofSignature:proof},rawBody:canonicalJson({...body,proofSignature:proof})};
  assert.equal(verifyPairExchangeProof(request,fingerprint).ok,true);
  assert.equal(verifyPairExchangeProof(request,hash('different desktop')).code,'service_fingerprint_mismatch');
  const tampered={...request,body:{...request.body,deviceName:'Other device'}};
  tampered.rawBody=canonicalJson(tampered.body);
  assert.equal(verifyPairExchangeProof(tampered,fingerprint).code,'pair_proof_invalid');
  const desktop=testKeyPair();
  const privateDer=desktop.privateKey.export({type:'pkcs8',format:'der'});
  const privateRaw=privateDer.subarray(privateDer.length-32).toString('base64url');
  let registered=0,confirmed=null,attempts=0;
  const scopes=['projects.read','sessions.read'];
  const approved=authorizePairExchange({request,expectedServiceFingerprint:fingerprint,recordPairAttempt:context=>{attempts++;assert.equal(context.pairingSessionId,body.pairingSessionId);return attempts<=5;},confirmLocally:context=>{confirmed=context;return true;},
    consumePairingCodeAndRegisterDevice:record=>{registered++;assert.equal(record.pairCode,'042817');assert.deepEqual(record.grantedScopes,scopes);return true;},
    grantedScopes:scopes,deviceId:'device_12345678',serverNonce:Buffer.alloc(32,4).toString('base64url'),expiresAt:'2026-11-21T15:00:00Z',desktopPrivateKey:privateRaw});
  assert.equal(approved.ok,true); assert.equal(registered,1); assert.equal(attempts,1); assert.deepEqual(confirmed.requestedScopes,scopes);
  assert.equal(verifyPairExchangeResponse(approved.response,desktop.publicKeyRaw,approved.requestId),true);
  assert.equal(authorizePairExchange({request,expectedServiceFingerprint:fingerprint,recordPairAttempt:()=>true,confirmLocally:()=>false,consumePairingCodeAndRegisterDevice:()=>{throw Error('must not register')},grantedScopes:scopes,deviceId:'device_12345678',serverNonce:Buffer.alloc(32,4).toString('base64url'),expiresAt:'2026-11-21T15:00:00Z',desktopPrivateKey:privateRaw}).code,'desktop_confirmation_required');
});
test('signed operation requests require all device-authentication header shapes',()=>{
  const base=request('projects.list','/remote/v1/projects');
  for (const name of REMOTE_V1.signedRequestHeaders) {
    const h={...base.headers}; delete h[name];
    assert.equal(validateRemoteRequest({...base,headers:h}).code,'signature_headers_missing');
  }
  assert.equal(validateRemoteRequest({...base,headers:{...base.headers,'x-pi-gui-token':'not-forwarded'}}).code,'signature_headers_invalid');
  assert.equal(validateRemoteRequest({...base,headers:{...base.headers,'x-pi-remote-body-sha256':'bad'}}).code,'signature_headers_invalid');
  // Signature shape and digest are checked here; actual key verification is tested below.
});



test('event stream accepts only bounded cursor and signed device headers',()=>{
  const base={method:'GET',path:'/remote/v1/events',headers:{...headersFor(''),'accept':'text/event-stream'},rawBody:'',query:{cursor:'opaque-cursor-01'}};
  assert.equal(validateRemoteRequest(base).ok,true);
  assert.equal(validateRemoteRequest({...base,query:{cursor:'x'.repeat(129)}}).ok,false);
  assert.equal(validateRemoteRequest({...base,query:{cursor:'c',projectPath:'C:/private'}}).ok,false);
  assert.equal(REMOTE_V1.eventStream.perDeviceBacklog,true);
  assert.equal(REMOTE_V1.eventStream.mustRevalidateAuthorizationBeforeReplay,true);
});

test('per-device event envelope has event-specific closed payloads and forbids path/payload leakage',()=>{
  const event={protocolVersion:1,sequence:1,conversationId:'conversation_12345678',ownerRevision:2,event:'message.append',payload:{messageId:'message_12345678',role:'assistant',text:'hello'}};
  assert.equal(validateEventEnvelope(event),true);
  assert.equal(validateEventEnvelope({...event,event:'arbitrary.tool'}),false);
  assert.equal(validateEventEnvelope({...event,payload:{messageId:'message_12345678',role:'assistant',text:'hello',sessionPath:'C:/secret'}}),false);
  assert.equal(validateEventEnvelope({...event,payload:{messageId:'message_12345678',role:'tool',text:'raw tool output'}}),false);
});

test('request envelope rejects unknown version, fields and duplicate transport paths',()=>{
  const base=request('chat.send','/remote/v1/conversations/conversation_12345678/messages',{clientMessageId:id,text:'hello'},{ownerRevision:1});
  assert.equal(validateRemoteRequest(replaceBody(base,{...base.body,protocolVersion:2})).code,'envelope_invalid');
  assert.equal(validateRemoteRequest(replaceBody(base,{...base.body,extra:true})).code,'envelope_invalid');
  assert.equal(validateRemoteRequest({...base,method:'PUT'}).code,'operation_route_mismatch');
  assert.equal(validateRemoteRequest({...base,path:'/api/command'}).code,'operation_route_mismatch');
});

test('responses use operation-specific closed projections and never carry raw errors/secrets/paths',()=>{
  const projectResult={projects:[{projectId:'project_12345678',displayName:'Demo'}]};
  assert.equal(validateRemoteResponse({protocolVersion:1,requestId:id,operation:'projects.list',serverRevision:7,result:projectResult},'projects.list',id),true);
  assert.equal(validateRemoteResponse({protocolVersion:1,requestId:id,operation:'projects.list',serverRevision:7,result:{projects:[{projectId:'project_12345678',displayName:'Demo',path:'C:/secret'}]}},'projects.list',id),false);
  assert.equal(validateRemoteResponse({protocolVersion:1,requestId:id,operation:'projects.list',serverRevision:7,result:{projects:[{projectId:'project_12345678',displayName:'Demo'}],accessToken:'secret'}},'projects.list',id),false);
  assert.equal(validateRemoteResponse({protocolVersion:1,requestId:id,operation:'chat.send',serverRevision:7,result:{accepted:true,ownerRevision:7,clientMessageId:id}},'projects.list',id),false);
  assert.equal(validateRemoteResponse({protocolVersion:1,requestId:id,error:{code:'stale_owner',retryable:true}},null,id),true);
  assert.equal(validateRemoteResponse({protocolVersion:1,requestId:id,error:{code:'failed',retryable:false,message:'raw detail'}},null,id),false);
  assert.equal(validateRemoteResponse({protocolVersion:2,requestId:id,operation:'projects.list',serverRevision:7,result:projectResult},'projects.list',id),false);
  assert.equal(validateRemoteResponse({protocolVersion:1,requestId:'4b1f3561-33e1-4aa1-8a54-8dc176cd5368',error:{code:'stale_owner',retryable:true}},null,id),false);
});

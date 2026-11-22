import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { REMOTE_V1, acceptEventFrame, authorizePairExchange, authorizeRemoteOperation, buildEventFrameMessage, buildPairProofMessage, buildSignatureMessage, filterGrantedResources, requiredEventScope, settleApproval, validateApprovalPayload, validateEventEnvelope, validatePairExchange, validatePairExchangeResponse, validateRemoteRequest, validateRemoteResponse, verifyPairExchangeProof, verifyPairExchangeResponse, verifyRemoteSignature, wireErrorCode } from '../scripts/lib/remote-protocol-contract.mjs';

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
const SERVICE_ID='service_demo_0001';
function signedRequest(unsigned,keyPair,nonce=Buffer.alloc(32,7).toString('base64url'),timestamp=Date.now().toString(),deviceId='device_abc12345',serviceId=SERVICE_ID) {
  const requestId=unsigned.body?.requestId ?? id;
  const bodyBytes=Buffer.from(unsigned.rawBody ?? '', 'utf8');
  const bodySha256=hash(bodyBytes);
  const message=buildSignatureMessage({protocolVersion:1,deviceId,serviceId,requestId,method:unsigned.method,path:unsigned.path,query:unsigned.query??{},timestamp,nonce,bodySha256});
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

test('signature canonicalization binds device, service, request identity, path/query, timestamp, nonce and body digest',()=>{
  const fields={protocolVersion:1,deviceId:'device_abc12345',serviceId:SERVICE_ID,requestId:id,method:'get',path:'/remote/v1/events',query:{z:'last value',cursor:'a/b'},timestamp:'1795273200000',nonce:'n'.repeat(43),bodySha256:hash('')};
  const expected=['1','device_abc12345',SERVICE_ID,id,'GET','/remote/v1/events?cursor=a%2Fb&z=last%20value','1795273200000','n'.repeat(43),hash('')].join('\n');
  assert.equal(buildSignatureMessage(fields),expected);
  assert.equal(buildSignatureMessage({...fields,query:{cursor:'a/b',z:'last value'}}),expected);
  assert.equal(buildSignatureMessage({...fields,query:{cursor:1}}),null);
  assert.equal(buildSignatureMessage({...fields,deviceId:'bad'}),null);
});
test('Ed25519 request signature, device+service binding, skew and atomic replay gate are exercised with synthetic keys',()=>{
  const pair=testKeyPair();
  const unsigned=request('chat.send','/remote/v1/conversations/conversation_12345678/messages',{clientMessageId:id,text:'synthetic only'},{ownerRevision:7});
  const timestamp=Date.now().toString();
  const nonce=Buffer.alloc(32,9).toString('base64url');
  const valid=signedRequest(unsigned,pair,nonce,timestamp);
  let consumed=0;
  const consumeNonce=(device,seenNonce,at)=>{assert.equal(device,'device_abc12345');assert.equal(seenNonce,nonce);assert.equal(at,Number(timestamp));consumed++;return consumed===1;};
  const device={deviceId:'device_abc12345',devicePublicKey:pair.publicKeyRaw,grantedScopes:['chat.send'],active:true};
  const verification={request:valid,device,serviceId:SERVICE_ID,nowMs:Number(timestamp),consumeNonce};
  const first=verifyRemoteSignature(verification);
  assert.equal(first.ok,true); assert.equal(first.operation,'chat.send'); assert.equal(first.scope,'chat.send'); assert.equal(first.deviceId,'device_abc12345'); assert.equal(consumed,1);
  // replay
  assert.equal(verifyRemoteSignature(verification).code,'request_replayed');
  // stale skew
  assert.equal(verifyRemoteSignature({...verification,nowMs:Number(timestamp)+61000,consumeNonce:()=>true}).code,'signature_expired');
  // missing/throwing store fails closed, not exception
  assert.equal(verifyRemoteSignature({...verification,consumeNonce:undefined}).code,'replay_store_unavailable');
  assert.equal(verifyRemoteSignature({...verification,consumeNonce:()=>{throw Error('disk')}}).code,'replay_store_unavailable');
  assert.equal(verifyRemoteSignature({...verification,consumeNonce:()=>Promise.resolve(true)}).code,'replay_store_unavailable');
  // wrong device key, wrong service, wrong identity
  const wrongKey=testKeyPair();
  const badSigned=signedRequest(unsigned,wrongKey,Buffer.alloc(32,11).toString('base64url'),timestamp);
  assert.equal(verifyRemoteSignature({request:badSigned,device:{...device},serviceId:SERVICE_ID,nowMs:Number(timestamp),consumeNonce:()=>true}).code,'signature_invalid');
  const otherService=signedRequest(unsigned,pair,Buffer.alloc(32,12).toString('base64url'),timestamp,device.deviceId,'other_service');
  assert.equal(verifyRemoteSignature({request:otherService,device,serviceId:SERVICE_ID,nowMs:Number(timestamp),consumeNonce:()=>true}).code,'signature_invalid');
  const otherDevice=signedRequest(unsigned,pair,Buffer.alloc(32,13).toString('base64url'),timestamp,'device_zzzz9999');
  assert.equal(verifyRemoteSignature({request:otherDevice,device,serviceId:SERVICE_ID,nowMs:Number(timestamp),consumeNonce:()=>true}).code,'device_identity_mismatch');
  // inactive device, invalid grant vocabulary, wrong scope
  assert.equal(verifyRemoteSignature({...verification,device:{...device,active:false}}).code,'device_inactive');
  assert.equal(verifyRemoteSignature({...verification,device:{...device,grantedScopes:['chat.send','admin.root']}}).code,'device_grants_invalid');
  assert.equal(verifyRemoteSignature({...verification,device:{...device,grantedScopes:['projects.read']}}).code,'scope_denied');
  // non-finite now fails closed
  assert.equal(verifyRemoteSignature({...verification,nowMs:NaN}).code,'signature_expired');
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
  const expiresAt=new Date(Date.now()+120000).toISOString();
  const approvalFor=()=>({peerId:'peer-1',reservePairBudget:()=>true,validatePairingSession:()=>true,recordPairAttempt:context=>{attempts++;assert.equal(context.peerId,'peer-1');assert.equal(context.pairingSessionId,body.pairingSessionId);return attempts<=5;},confirmLocally:context=>{confirmed=context;return 'approval_01';},consumePairingCodeAndRegisterDevice:record=>{registered++;assert.equal(record.pairCode,'042817');assert.equal(record.approvalId,'approval_01');assert.deepEqual(record.grantedScopes,scopes);return true;}});
  const approved=authorizePairExchange({request,expectedServiceFingerprint:fingerprint,...approvalFor(),grantedScopes:scopes,deviceId:'device_12345678',serverNonce:Buffer.alloc(32,4).toString('base64url'),expiresAt,desktopPrivateKey:privateRaw});
  assert.equal(approved.ok,true); assert.equal(registered,1); assert.equal(attempts,1); assert.deepEqual(confirmed.requestedScopes,scopes);
  assert.equal(confirmed.pairCode,'042817'); assert.equal(confirmed.clientNonce,body.clientNonce); assert.equal(typeof confirmed.proofTranscript,'string');
  // response needs a live outstanding exchange; retired atomically
  const outstanding={clientNonce:body.clientNonce,approvedScopes:scopes};
  let retired=0;
  assert.equal(verifyPairExchangeResponse(approved.response,desktop.publicKeyRaw,approved.requestId,{outstandingExchange:outstanding,retireExchange:()=>{retired++;return true;}}),true);
  assert.equal(retired,1);
  // second presentation without outstanding state is rejected
  assert.equal(verifyPairExchangeResponse(approved.response,desktop.publicKeyRaw,approved.requestId,{outstandingExchange:{clientNonce:'x'.repeat(43)},retireExchange:()=>true}),false);
  assert.equal(verifyPairExchangeResponse(approved.response,desktop.publicKeyRaw,approved.requestId,{outstandingExchange:{clientNonce:body.clientNonce,approvedScopes:['chat.send']},retireExchange:()=>true}),false);
  assert.equal(verifyPairExchangeResponse(approved.response,testKeyPair().publicKeyRaw,approved.requestId,{outstandingExchange:outstanding,retireExchange:()=>true}),false);
  // budget is reserved BEFORE session validation; session lookup not reached on exhaustion
  let sessionLookedUp=false;
  assert.equal(authorizePairExchange({request,expectedServiceFingerprint:fingerprint,peerId:'peer-1',reservePairBudget:()=>false,validatePairingSession:()=>{sessionLookedUp=true;return true;},recordPairAttempt:()=>true,confirmLocally:()=>'a',consumePairingCodeAndRegisterDevice:()=>true,grantedScopes:scopes,deviceId:'d_12345678',serverNonce:Buffer.alloc(32,4).toString('base64url'),expiresAt,desktopPrivateKey:privateRaw}).code,'pair_rate_limited');
  assert.equal(sessionLookedUp,false);
  // live session must be validated BEFORE confirmation; confirmation not reached on bad session
  let prompted=false;
  assert.equal(authorizePairExchange({request,expectedServiceFingerprint:fingerprint,peerId:'peer-1',reservePairBudget:()=>true,validatePairingSession:()=>false,recordPairAttempt:()=>true,confirmLocally:()=>{prompted=true;return 'a';},consumePairingCodeAndRegisterDevice:()=>true,grantedScopes:scopes,deviceId:'device_12345678',serverNonce:Buffer.alloc(32,4).toString('base64url'),expiresAt,desktopPrivateKey:privateRaw}).code,'pairing_session_invalid');
  assert.equal(prompted,false);
  // confirmation must return an approvalId bound to the transcript; bare true rejected
  assert.equal(authorizePairExchange({request,expectedServiceFingerprint:fingerprint,peerId:'peer-1',reservePairBudget:()=>true,validatePairingSession:()=>true,recordPairAttempt:()=>true,confirmLocally:()=>true,consumePairingCodeAndRegisterDevice:()=>true,grantedScopes:scopes,deviceId:'device_12345678',serverNonce:Buffer.alloc(32,4).toString('base64url'),expiresAt,desktopPrivateKey:privateRaw}).code,'desktop_confirmation_required');
  // past expiresAt rejected before signing/registering
  assert.equal(authorizePairExchange({request,expectedServiceFingerprint:fingerprint,peerId:'peer-1',reservePairBudget:()=>true,validatePairingSession:()=>true,recordPairAttempt:()=>true,confirmLocally:()=>'a',consumePairingCodeAndRegisterDevice:()=>{throw Error('must not register')},grantedScopes:scopes,deviceId:'device_12345678',serverNonce:Buffer.alloc(32,4).toString('base64url'),expiresAt:'2020-01-01T00:00:00Z',desktopPrivateKey:privateRaw}).code,'pair_response_invalid');
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



test('event stream accepts only a pattern-bound cursor and signed device headers',()=>{
  const base={method:'GET',path:'/remote/v1/events',headers:{...headersFor(''),'accept':'text/event-stream'},rawBody:'',query:{cursor:'opaque-cursor-01'}};
  assert.equal(validateRemoteRequest(base).ok,true);
  assert.equal(validateRemoteRequest(base).cursor,'opaque-cursor-01');
  assert.equal(validateRemoteRequest({...base,query:{cursor:'x'.repeat(129)}}).code,'cursor_invalid');
  assert.equal(validateRemoteRequest({...base,query:{cursor:''}}).code,'cursor_invalid');
  assert.equal(validateRemoteRequest({...base,query:{cursor:'bad/cursor'}}).code,'cursor_invalid');
  assert.equal(validateRemoteRequest({...base,query:{cursor:'c',projectPath:'C:/private'}}).code,'query_invalid');
  assert.equal(REMOTE_V1.eventStream.perDeviceBacklog,true);
  assert.equal(REMOTE_V1.eventStream.mustRevalidateAuthorizationBeforeReplay,true);
  assert.equal(REMOTE_V1.eventStream.frameAuthentication.signed,true);
});

test('event frames carry generation/cursor/signature, per-event scopes and closed payloads',()=>{
  const desktop=testKeyPair();
  const base={protocolVersion:1,sequence:1,conversationId:'conversation_12345678',ownerRevision:2,streamGeneration:1,cursor:'cur_abc123',event:'message.append',payload:{messageId:'message_12345678',role:'assistant',text:'hello'}};
  base.frameSignature=sign(null,Buffer.from(buildEventFrameMessage(base,'device_abc12345'),'utf8'),desktop.privateKey).toString('base64url');
  assert.equal(validateEventEnvelope(base),true);
  assert.equal(acceptEventFrame({event:base,deviceId:'device_abc12345',desktopPublicKey:desktop.publicKeyRaw,deviceScopes:['sessions.read'],expectedStreamGeneration:1,expectedSequence:1}).ok,true);
  // approval events require approvals.read even when conversation is owned
  assert.equal(requiredEventScope('approval.pending'),'approvals.read');
  const approval={...base,event:'approval.pending',payload:{requestId:'req_12345678',method:'confirm',title:'t',message:'m'}};
  approval.frameSignature=sign(null,Buffer.from(buildEventFrameMessage(approval,'device_abc12345'),'utf8'),desktop.privateKey).toString('base64url');
  assert.equal(acceptEventFrame({event:approval,deviceId:'device_abc12345',desktopPublicKey:desktop.publicKeyRaw,deviceScopes:['sessions.read','approvals.read'],expectedStreamGeneration:1,expectedSequence:1}).ok,true);
  assert.equal(acceptEventFrame({event:approval,deviceId:'device_abc12345',desktopPublicKey:desktop.publicKeyRaw,deviceScopes:['sessions.read'],expectedStreamGeneration:1,expectedSequence:1}).code,'scope_denied');
  // wrong key/device/generation/sequence rejected
  assert.equal(acceptEventFrame({event:base,deviceId:'device_abc12345',desktopPublicKey:testKeyPair().publicKeyRaw,deviceScopes:['sessions.read']}).code,'frame_signature_invalid');
  assert.equal(acceptEventFrame({event:base,deviceId:'device_other001',desktopPublicKey:desktop.publicKeyRaw,deviceScopes:['sessions.read']}).code,'frame_signature_invalid');
  assert.equal(acceptEventFrame({event:base,deviceId:'device_abc12345',desktopPublicKey:desktop.publicKeyRaw,deviceScopes:['sessions.read'],expectedStreamGeneration:2}).code,'sequence_gap');
  assert.equal(acceptEventFrame({event:base,deviceId:'device_abc12345',desktopPublicKey:desktop.publicKeyRaw,deviceScopes:['sessions.read'],expectedSequence:2}).code,'sequence_gap');
  // missing frame fields, unknown event, forbidden key, payload ownerRevision conflict
  const noSig={...base};delete noSig.frameSignature;
  assert.equal(validateEventEnvelope(noSig),false);
  assert.equal(validateEventEnvelope({...base,event:'arbitrary.tool'}),false);
  const leak={...base,payload:{messageId:'m_12345678',role:'assistant',text:'x',sessionPath:'C:/secret'}};
  assert.equal(validateEventEnvelope(leak),false);
  const conflict={...base,payload:{messageId:'m_12345678',role:'assistant',text:'x',ownerRevision:9}};
  assert.equal(validateEventEnvelope(conflict),false);
  // stream-wide reset uses the reserved reset conversation id and a closed reason
  const reset={...base,event:'reset',conversationId:'stream-reset',payload:{reason:'authorization_changed'}};
  reset.frameSignature=sign(null,Buffer.from(buildEventFrameMessage(reset,'device_abc12345'),'utf8'),desktop.privateKey).toString('base64url');
  assert.equal(validateEventEnvelope(reset),true);
  assert.equal(validateEventEnvelope({...reset,conversationId:'conversation_12345678'}),false);
  assert.equal(validateEventEnvelope({...reset,payload:{reason:'unexpected'}}),false);
  // owner-filtered replay: a frame signed for an ungranted conversation stays invalid at acceptance
});

test('request envelope rejects unknown version, fields and duplicate transport paths',()=>{
  const base=request('chat.send','/remote/v1/conversations/conversation_12345678/messages',{clientMessageId:id,text:'hello'},{ownerRevision:1});
  assert.equal(validateRemoteRequest(replaceBody(base,{...base.body,protocolVersion:2})).code,'envelope_invalid');
  assert.equal(validateRemoteRequest(replaceBody(base,{...base.body,extra:true})).code,'envelope_invalid');
  assert.equal(validateRemoteRequest({...base,method:'PUT'}).code,'operation_route_mismatch');
  assert.equal(validateRemoteRequest({...base,path:'/api/command'}).code,'operation_route_mismatch');
});

test('responses use operation-specific closed projections and never carry raw errors/secrets/paths',()=>{
  const projectResult={projects:[{projectId:'project_12345678',displayName:'Demo'}],registryRevision:3};
  assert.equal(validateRemoteResponse({protocolVersion:1,requestId:id,operation:'projects.list',serverRevision:7,result:projectResult},'projects.list',id),true);
  assert.equal(validateRemoteResponse({protocolVersion:1,requestId:id,operation:'projects.list',serverRevision:7,result:{projects:[{projectId:'project_12345678',displayName:'Demo',path:'C:/secret'}],registryRevision:3}},'projects.list',id),false);
  assert.equal(validateRemoteResponse({protocolVersion:1,requestId:id,operation:'projects.list',serverRevision:7,result:{projects:[{projectId:'project_12345678',displayName:'C:/absolute'}],registryRevision:3}},'projects.list',id),false);
  assert.equal(validateRemoteResponse({protocolVersion:1,requestId:id,operation:'projects.list',serverRevision:7,result:{projects:[{projectId:'project_12345678',displayName:'Demo'}],registryRevision:3,accessToken:'secret'}},'projects.list',id),false);
  assert.equal(validateRemoteResponse({protocolVersion:1,requestId:id,operation:'chat.send',serverRevision:7,result:{accepted:true,ownerRevision:7,clientMessageId:id}},'projects.list',id),false);
  assert.equal(validateRemoteResponse({protocolVersion:1,requestId:id,error:{code:'stale_owner',retryable:true}},null,id),true);
  assert.equal(validateRemoteResponse({protocolVersion:1,requestId:id,error:{code:'failed',retryable:false,message:'raw detail'}},null,id),false);
  assert.equal(validateRemoteResponse({protocolVersion:2,requestId:id,operation:'projects.list',serverRevision:7,result:projectResult},'projects.list',id),false);
  assert.equal(validateRemoteResponse({protocolVersion:1,requestId:'4b1f3561-33e1-4aa1-8a54-8dc176cd5368',error:{code:'stale_owner',retryable:true}},null,id),false);
});

test('device grants and owner recheck gate admission (IDOR / stale owner / substitution)',()=>{
  const pair=testKeyPair();
  const device={deviceId:'device_abc12345',devicePublicKey:pair.publicKeyRaw,grantedScopes:['sessions.read','chat.send'],active:true,grants:{'project_12345678':true,'conversation_12345678':true}};
  const ts=Date.now().toString();
  const ownedConvo='conversation_12345678';
  const send=(path,ownerRev=3)=>signedRequest(request('chat.send',path,{clientMessageId:id,text:'x'},{ownerRevision:ownerRev}),pair,Buffer.alloc(32,10).toString('base64url'),ts);
  const baseArgs={device,serviceId:SERVICE_ID,nowMs:Number(ts),consumeNonce:()=>true};
  // granted conversation + current full owner admits
  const ok=authorizeRemoteOperation({...baseArgs,request:send(`/remote/v1/conversations/${ownedConvo}/messages`),resolveOwner:()=>({current:true,revision:3,namespace:'runtime',identity:'rt-1'})});
  assert.equal(ok.ok,true); assert.equal(ok.owner.namespace,'runtime');
  // ungranted conversation = IDOR, rejected before owner resolution
  let resolveCalled=false;
  const idor=authorizeRemoteOperation({...baseArgs,request:send('/remote/v1/conversations/conversation_other00/messages'),resolveOwner:()=>{resolveCalled=true;return {current:true,revision:3,namespace:'runtime',identity:'rt-1'};}});
  assert.equal(idor.code,'unknown_resource'); assert.equal(resolveCalled,false);
  // stale owner / stale revision / substitution rejected
  assert.equal(authorizeRemoteOperation({...baseArgs,request:send(`/remote/v1/conversations/${ownedConvo}/messages`),resolveOwner:()=>({current:false,namespace:'runtime',revision:3,identity:'rt-1'})}).code,'stale_owner');
  assert.equal(authorizeRemoteOperation({...baseArgs,request:send(`/remote/v1/conversations/${ownedConvo}/messages`,4),resolveOwner:()=>({current:true,revision:9,namespace:'runtime',identity:'rt-1'})}).code,'stale_revision');
  // untyped owner (missing namespace/identity) rejected as stale
  assert.equal(authorizeRemoteOperation({...baseArgs,request:send(`/remote/v1/conversations/${ownedConvo}/messages`),resolveOwner:()=>({current:true,revision:3})}).code,'stale_owner');
  assert.equal(authorizeRemoteOperation({...baseArgs,request:send(`/remote/v1/conversations/${ownedConvo}/messages`),resolveOwner:()=>{throw Error('gone')}}).code,'stale_owner');
  // grant store absent fails closed
  const noGrants={...device,grants:undefined};
  assert.equal(authorizeRemoteOperation({...baseArgs,device:noGrants,request:send(`/remote/v1/conversations/${ownedConvo}/messages`),resolveOwner:()=>({current:true,revision:3,namespace:'runtime',identity:'rt-1'})}).code,'grant_store_unavailable');
  // list filtering through same grants
  const items=[{projectId:'project_12345678',displayName:'A'},{projectId:'project_other00',displayName:'B'},{displayName:'no-id'}];
  assert.deepEqual(filterGrantedResources(items,device).map(i=>i.displayName),['A']);
});

test('approval payload enforces the per-method decision/value matrix',()=>{
  assert.equal(validateApprovalPayload({method:'confirm',decision:'allow'}),true);
  assert.equal(validateApprovalPayload({method:'confirm',decision:'answer'}),false);
  assert.equal(validateApprovalPayload({method:'select',decision:'answer',value:'opt_a'}),true);
  assert.equal(validateApprovalPayload({method:'select',decision:'answer'}),false);
  assert.equal(validateApprovalPayload({method:'input',decision:'answer'}),false);
  assert.equal(validateApprovalPayload({method:'input',decision:'cancel',value:'x'}),false);
  assert.equal(validateApprovalPayload({method:'editor',decision:'answer',value:'x'}),true);
});

test('approval settlement resolves and consumes a live Pi dialog exactly once',()=>{
  const pair=testKeyPair();
  const reqId='req_pending_01';
  const device={deviceId:'device_abc12345',devicePublicKey:pair.publicKeyRaw,grantedScopes:['approvals.respond'],active:true,grants:{'conversation_12345678':true}};
  const ts=Date.now().toString();
  const respond=(method='confirm',decision='allow',value)=>signedRequest(request('approvals.respond',`/remote/v1/conversations/conversation_12345678/approvals/${reqId}/respond`,{method,decision,...(value===undefined?{}:{value})},{ownerRevision:5}),pair,Buffer.alloc(32,14).toString('base64url'),ts);
  const owner={current:true,revision:5,namespace:'runtime',identity:'rt-1'};
  const dialog={requestId:reqId,owner:'rt-1',pending:true,method:'confirm'};
  let consumed=0;
  const base={device,serviceId:SERVICE_ID,deviceResolveOwner:()=>owner,pendingDialog:dialog,consumeDialog:()=>{consumed++;return consumed===1;},nowMs:Number(ts),consumeNonce:()=>true};
  const ok=settleApproval({...base,request:respond()});
  assert.equal(ok.ok,true); assert.equal(consumed,1);
  // duplicate settlement: dialog already consumed -> second consume returns false
  assert.equal(settleApproval({...base,request:respond()}).code,'stale_owner');
  // wrong method vs authoritative dialog, stale owner, non-pending, option not offered
  assert.equal(settleApproval({...base,request:respond('select','answer','opt_x'),pendingDialog:{...dialog,method:'select',options:['opt_a']}}).code,'payload_invalid');
  assert.equal(settleApproval({...base,request:respond('select','answer','opt_x'),pendingDialog:{...dialog,method:'select',options:['opt_x']},consumeDialog:()=>true}).ok,true);
  assert.equal(settleApproval({...base,request:respond(),pendingDialog:{...dialog,owner:'rt-2'}}).code,'stale_owner');
  assert.equal(settleApproval({...base,request:respond(),pendingDialog:{...dialog,pending:false}}).code,'stale_owner');
});

test('pre-auth failures map to a closed wire code and internal codes never leak',()=>{
  for(const internal of ['signature_invalid','signature_expired','device_identity_mismatch','body_parse_mismatch','operation_route_mismatch','replay_store_unavailable']) {
    const wire=wireErrorCode(internal);
    assert.ok(REMOTE_V1.responseEnvelope.errorCodes.includes(wire));
  }
  assert.equal(wireErrorCode('signature_invalid'),'unauthorized');
  assert.equal(wireErrorCode('request_replayed'),'replay_rejected');
  assert.equal(wireErrorCode('unknown_resource'),'unknown_resource');
});

test('UTF-8 byte limits and duplicate query params are enforced',()=>{
  const pair=testKeyPair();
  const device={deviceId:'device_abc12345',devicePublicKey:pair.publicKeyRaw,grantedScopes:['chat.send'],active:true};
  // multibyte text at/over byte limit
  const heavy='\u4e2d'.repeat(Math.ceil(REMOTE_V1.limits.maxChatTextUtf8Bytes/3));
  const over=request('chat.send','/remote/v1/conversations/conversation_12345678/messages',{clientMessageId:id,text:heavy},{ownerRevision:1});
  assert.equal(validateRemoteRequest(over).ok,false);
  // undeclared query parameter rejected (wire-level duplicate params rejected per contract)
  const dup={method:'GET',path:'/remote/v1/events',headers:{...headersFor(''),'accept':'text/event-stream'},rawBody:'',query:{cursor:'a',cursor2:'a'}};
  assert.equal(validateRemoteRequest(dup).code,'query_invalid');
  // malformed UTF-8 body rejected strictly
  const bad={method:'POST',path:'/remote/v1/conversations/conversation_12345678/messages',headers:{...headersFor('x'),'content-type':'application/json; charset=utf-8'},rawBody:Buffer.from([0xff,0xfe]),body:{}};
  assert.equal(validateRemoteRequest(bad).code,'body_parse_mismatch');
});

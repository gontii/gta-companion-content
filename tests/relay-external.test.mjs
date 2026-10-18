import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';

test('przekaźnik z alarmami zewnętrznymi nie wymaga tokena GitHub i nie wysyła zgłoszeń', async () => {
  const calls=[];
  const server=http.createServer((req,res)=>{
    calls.push(req.url);
    assert.equal(req.headers.authorization,'Bearer test-local-only');
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify(req.url==='/status'?{mode:'publish',heartbeatAt:new Date().toISOString(),incidents:[{key:'example',reason:'test'}]}:{entries:[]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const {GH_TOKEN,GITHUB_TOKEN,...env}=process.env;
    const child=spawn(process.execPath,['scripts/github-relay.mjs'],{env:{...env,CONTENT_INCIDENTS_MODE:'external',CONTENT_UPDATER_URL:`http://127.0.0.1:${server.address().port}`,CONTENT_AUTOMATION_TOKEN:'test-local-only'}});
    let output='',error='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);
    const code=await new Promise(resolve=>child.on('close',resolve));
    assert.equal(code,0,error);assert.deepEqual(calls,['/status','/outbox']);assert.equal(JSON.parse(output).copied,0);
    assert.ok(!output.includes('test-local-only'));
  } finally {await new Promise(resolve=>server.close(resolve));}
});

'use strict';
const VERSION='0.1.7';
// デプロイ後のWorker URLに変更してください。
const SERVER_URL='https://strange-slot-online.naitoryo7110.workers.dev';
const COMMON_PLAYER_NAME_KEY='boardgamePlayerName';
const NAME_DRAFT_KEY='sss_name_draft';
const GAME_ID='strange_slot_simulator';
const GAME_NAME='ストレンジスロットシミュレーター';
const ROOM_IDS=['room1','room2','room3','room4'];
const ACTIVE_ROOM_KEY=`${GAME_ID}-online-room`;
const ACTIVE_NAME_KEY=`${GAME_ID}-online-active-name`;
let actionSeq=0,lastRooms=[];
const SYMBOLS=[
 {id:'bell',name:'ベル',noteName:'ベル',icon:'🔔'},
 {id:'grape',name:'ブドウ',noteName:'ブドウ',icon:'🍇'},
 {id:'cherry',name:'チェリー',noteName:'チェリー',icon:'🍒'},
 {id:'watermelon',name:'スイカ',noteName:'スイカ',icon:'🍉'},
 {id:'bellCherry',name:'ベル＋チェリー',noteName:'',icon:'🔔🍒'},
 {id:'bellWatermelon',name:'ベル＋スイカ',noteName:'',icon:'🔔🍉'},
 {id:'sun',name:'太陽',noteName:'太陽',icon:'☀️'},
 {id:'moon',name:'月',noteName:'月',icon:'🌙'}
];
let roomId=null, token=null, state=null, ws=null, me=null, finalAnswerDraft=null, finalDraftSession=null;
let yellowArmed=false, deleteMode=false, revealBusy=false, localTimer=null;
// 抽選結果DOMは通常のstate再描画から分離する。再接続時だけlastDrawを1回復元する。
let drawDisplaySession=null;
// ロビー設定は保存せず、この画面で編集中のDraftだけ保持する。
let lobbySettingsDraft=null, lobbySettingsDirty=false, lobbySettingsRoom=null;
let notebooks={}, currentNoteMachine='A';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function toast(t){const e=$('#toast');e.textContent=t;e.classList.remove('hidden');setTimeout(()=>e.classList.add('hidden'),2200)}
function pop(t){const e=$('#bigPop');e.textContent=t;e.classList.remove('hidden');setTimeout(()=>e.classList.add('hidden'),1800)}
function setView(id){$$('.view').forEach(v=>v.classList.remove('active'));$('#'+id).classList.add('active')}
function getName(){return $('#nameInput').value.trim()}
function commonSavedName(){return String(localStorage.getItem(COMMON_PLAYER_NAME_KEY)||'').trim().slice(0,32)}
function saveCommonNameOnActualStart(n){n=String(n||'').trim().slice(0,32);if(n)localStorage.setItem(COMMON_PLAYER_NAME_KEY,n)}
function loadName(){return sessionStorage.getItem(NAME_DRAFT_KEY)??commonSavedName()??''}
function sessionKey(r){return `${GAME_ID}-online-token-${r}`}
function legacySessionKey(r){return `sss_token_room_${r}`}
function newActionId(prefix='op'){actionSeq=(actionSeq+1)%1000000;return [prefix,Date.now(),actionSeq,Math.random().toString(36).slice(2,8)].join('-')}
function getOrCreateToken(r){let t=localStorage.getItem(sessionKey(r))||localStorage.getItem(legacySessionKey(r));if(!t)t=crypto.randomUUID().replace(/-/g,'');localStorage.setItem(sessionKey(r),t);return t}
function noteKey(r,n){return `sss_notes_${r}_${n}_${state?.gameSessionId||'lobby'}`}
function saveNotes(){if(roomId&&me)localStorage.setItem(noteKey(roomId,me.name),JSON.stringify(notebooks))}
function loadNotes(){try{return JSON.parse(localStorage.getItem(noteKey(roomId,me?.name))||'{}')}catch{return {}}}
function blankSheet(){return {pred:[],spins:[],memo:''}}
function ensureNotes(){for(const m of ['A','B','C','D','E','F']) if(!notebooks[m])notebooks[m]=blankSheet()}
async function api(path,opts={}){const r=await fetch(SERVER_URL+path,{...opts,headers:{'content-type':'application/json',...(opts.headers||{})}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);return j}
async function loadRooms(){try{const d=await api('/api/rooms');const incoming=Array.isArray(d.rooms)?d.rooms:[];const merged=ROOM_IDS.map(id=>{const fresh=incoming.find(x=>x.id===id);const old=lastRooms.find(x=>x.id===id);return fresh&&!fresh.error?fresh:(old||fresh||{id,players:[],status:'lobby',maxPlayers:5,error:true})});lastRooms=merged;renderRooms(merged)}catch(e){if(lastRooms.length)renderRooms(lastRooms);else renderRooms(ROOM_IDS.map(id=>({id,players:[],status:'lobby',maxPlayers:5,error:true})));toast('サーバーへ接続できません')}}
function roomStatusLabel(r){if(r?.error)return '取得失敗';if(r?.status==='playing')return 'ゲーム中';if(r?.status==='finished')return '終了';return '待機中'}
function renderRooms(rooms){const box=$('#rooms');box.innerHTML='';for(let i=1;i<=4;i++){const id=ROOM_IDS[i-1];const r=rooms.find(x=>x.id===id)||{id,players:[],status:'lobby',maxPlayers:5,error:true};const div=document.createElement('article');div.className='room'+(r.error?' error':'');div.innerHTML=`<h3>ROOM ${i}</h3><div class="state">${roomStatusLabel(r)}</div><div>${r.players?.length||0}/${r.maxPlayers||5}人</div><div class="names">参加者：${r.players?.length?esc(r.players.join(' / ')):'なし'}</div>${r.error?'<div class="fetch-error">前回取得情報を表示中</div>':''}<div class="room-actions"><button class="room-join" data-room="${id}">${r.players?.length?'参加する':'新規作成'}</button><button class="room-reset danger" data-reset="${id}">初期化</button></div>`;box.appendChild(div)}box.querySelectorAll('[data-room]').forEach(b=>b.onclick=()=>joinRoom(b.dataset.room));box.querySelectorAll('[data-reset]').forEach(b=>b.onclick=()=>resetEmptyRoom(b.dataset.reset))}
async function resetEmptyRoom(id){const no=id.replace('room','');if(!confirm(`ROOM ${no} を初期化しますか？`))return;try{await api(`/reset-empty?roomId=${encodeURIComponent(id)}`,{method:'POST'});await loadRooms()}catch(e){toast(e.message)}}
function phaseLabel(p){return ({empty:'空室',lobby:'待機中',ticket:'抽選券選択',machine_select:'台選択',investigate:'調査中',round_end:'ラウンド終了',thinking:'シンキング',final_answer:'最終回答',result:'結果'})[p]||p}
async function checkRoomJoin(r,name,t){const q=new URLSearchParams({roomId:r,name,token:t});return api(`/join-check?${q.toString()}`,{method:'GET'})}
async function joinRoom(r,forcedName=null){const name=String(forcedName??getName()).trim();if(!name)return toast('名前を入力してください');const t=getOrCreateToken(r);try{await checkRoomJoin(r,name,t);const d=await api(`/api/room/${r}/join`,{method:'POST',body:JSON.stringify({name,token:t})});roomId=r;token=d.token||t;localStorage.setItem(sessionKey(r),token);localStorage.setItem(ACTIVE_ROOM_KEY,r);localStorage.setItem(ACTIVE_NAME_KEY,name);$('#nameInput').value=name;await fetchState();connectWs();$('#leaveBtn').classList.remove('hidden')}catch(e){toast(e.message)}}
async function fetchState(){if(!roomId||!token)return;state=await api(`/api/room/${roomId}/state?token=${encodeURIComponent(token)}`);onState(state)}
function connectWs(){if(ws)try{ws.close()}catch{};const u=SERVER_URL.replace(/^http/,'ws')+`/api/room/${roomId}/ws?token=${encodeURIComponent(token)}`;ws=new WebSocket(u);ws.onmessage=ev=>{try{const m=JSON.parse(ev.data);if(m.type==='state')onState(m.state);if(m.type==='draw')onDraw(m)}catch{}};ws.onclose=()=>{if(roomId)setTimeout(connectWs,1300)}}
function scheduleReconnect(){if(roomId&&(!ws||ws.readyState!==WebSocket.OPEN))setTimeout(()=>{if(roomId)connectWs()},250)}
function onState(s){const prevSession=state?.gameSessionId;state=s;me=s.me;if(prevSession&&s.gameSessionId!==prevSession){notebooks={};finalAnswerDraft=null;finalDraftSession=null;drawDisplaySession=null;clearDrawDisplay()}if(s.gameSessionId&&s.phase!=='lobby'&&s.phase!=='empty'){const k='sss_saved_common_name_'+s.gameSessionId;if(!sessionStorage.getItem(k)){saveCommonNameOnActualStart(me?.name);sessionStorage.setItem(k,'1')}}if(s.phase!=='final_answer'){finalAnswerDraft=null;finalDraftSession=null}$('#phaseMini').textContent=`R${s.round||'-'} ${phaseLabel(s.phase)}`;if(s.phase==='lobby'){setView('lobbyView');renderLobby();drawDisplaySession=null;clearDrawDisplay()}else if(s.phase==='empty'){leaveLocal();return}else{setView('gameView');if(!Object.keys(notebooks).length){notebooks=loadNotes();ensureNotes()}renderGame();hydrateDrawDisplayOnce()}startTimer()}
function renderLobby(){$('#roomNo').textContent=String(roomId).replace('room','');$('#lobbyPlayers').innerHTML=state.players.map(p=>`<div class="player-card ${p.id===me.id?'me':''}"><b>${esc(p.name)}</b><span>${p.isHost?'HOST':''}</span></div>`).join('');const host=me.isHost;$('#hostSettings').classList.toggle('hidden',!host);if(host){if(lobbySettingsRoom!==roomId||!lobbySettingsDraft){lobbySettingsRoom=roomId;lobbySettingsDraft={investigateSec:state.settings.investigateSec,thinkingSec:state.settings.thinkingSec,finalThinkingSec:state.settings.finalThinkingSec};lobbySettingsDirty=false}if(!lobbySettingsDirty){lobbySettingsDraft={investigateSec:state.settings.investigateSec,thinkingSec:state.settings.thinkingSec,finalThinkingSec:state.settings.finalThinkingSec}}writeLobbySettingsDraft()}$('#autoRecordToggle').checked=localStorage.getItem('sss_auto_record')==='1'}
function writeLobbySettingsDraft(){if(!lobbySettingsDraft)return;$('#investigateSec').value=lobbySettingsDraft.investigateSec;$('#thinkingSec').value=lobbySettingsDraft.thinkingSec;$('#finalThinkingSec').value=lobbySettingsDraft.finalThinkingSec}
function readLobbySettingsDraft(){return {investigateSec:+$('#investigateSec').value,thinkingSec:+$('#thinkingSec').value,finalThinkingSec:+$('#finalThinkingSec').value}}
function markLobbySettingsDirty(){if(!me?.isHost)return;lobbySettingsDraft=readLobbySettingsDraft();lobbySettingsDirty=true}
function renderGame(){renderPlayers();$('#roundInfo').innerHTML=`<b>ラウンド ${state.round}/4</b><br>${phaseLabel(state.phase)}${state.selectTurnName?`<br>選択：${esc(state.selectTurnName)}`:''}`;$('#machineBox').innerHTML=`現在台：<b>${me.machine||'なし'}</b>${me.ticket!=null?`<br>抽選券：${me.ticket}`:''}`;$('#moveBtn').disabled=state.phase!=='investigate'||!me.machine||state.moveLocked;$('#moveBtn').textContent=state.moveLocked?`${state.moveLockName||'誰か'}が台移動中`:'台移動';renderTicket();renderMachineSelect();renderDrawControls();renderNotebook();renderRoundTransition();renderFinalAnswer();renderResult()}
function renderPlayers(){const h=state.players.map(p=>`<div class="player-card ${p.id===me.id?'me':''} ${p.red?'red':''}"><b>${esc(p.name)}</b><span>🔔${p.publicBell}　🟡${p.publicYellow}${p.red?'　🔴':''}</span></div>`).join('');$('#playersGame').innerHTML=h}
function renderTicket(){const a=$('#ticketArea');a.classList.toggle('hidden',state.phase!=='ticket');if(state.phase!=='ticket')return;if(me.ticketChosen){a.innerHTML='<div style="grid-column:1/-1;text-align:center">全員の選択を待っています…</div>';return}a.innerHTML=state.ticketSlots.map((_,i)=>`<button class="ticket" data-i="${i}">?</button>`).join('');a.querySelectorAll('button').forEach(b=>b.onclick=()=>action('pickTicket',{slot:+b.dataset.i}))}
function renderMachineSelect(){const a=$('#machineSelectArea');const initial=state.phase==='machine_select';const rejoin=state.phase==='investigate'&&!me.machine&&state.rejoinSelectTurnId;const on=initial||rejoin;a.classList.toggle('hidden',!on);if(!on)return;const mine=initial?state.selectTurnId===me.id:state.rejoinSelectTurnId===me.id;const waitingName=initial?state.selectTurnName:state.rejoinSelectTurnName;const occ=new Map(state.players.filter(p=>p.machine).map(p=>[p.machine,p.name]));a.innerHTML=`<div style="grid-column:1/-1;text-align:center">${mine?(rejoin?'再入場：台を選んでください':'台を選んでください'):`${esc(waitingName||'')} の選択待ち`}</div>`+['A','B','C','D','E','F'].map(m=>`<button class="machine-btn ${occ.has(m)?'occupied':''}" data-m="${m}" ${!mine||occ.has(m)?'disabled':''}>${m}${occ.has(m)?`<br>${esc(occ.get(m))}使用中`:''}</button>`).join('');a.querySelectorAll('[data-m]').forEach(b=>b.onclick=()=>action(rejoin?'selectRejoinMachine':'selectMachine',{machine:b.dataset.m}))}
function renderDrawControls(){const show=['investigate','round_end','thinking'].includes(state.phase);$('#drawArea').classList.toggle('hidden',!show);$('#drawBtn').disabled=state.phase!=='investigate'||!me.machine||revealBusy;$('#yellowBtn').disabled=state.phase!=='investigate'||me.yellow<=0||revealBusy;$('#yellowBtn').textContent=`目押し ×${me.yellow}`;$('#yellowBtn').classList.toggle('active',yellowArmed);$('#bonusInfo').innerHTML=`ボーナスカウント 🔔 <b>${me.bell}</b>　<span class="yellow-chip">🟡 ${me.yellow}</span>　${me.red?'<span class="red-chip">🔴 上位突入 / 4枚抽選</span>':'通常3枚抽選'}`;}
function symbolDef(id){return SYMBOLS.find(x=>x.id===id)||{name:id,icon:'?'}}
function clearDrawDisplay(){$('#drawCards').replaceChildren()}
function showCards(ids,clear=true){const box=$('#drawCards');if(clear)box.replaceChildren();for(const id of ids){const s=symbolDef(id);const d=document.createElement('div');d.className='slot-card';d.innerHTML=`<div class="icon">${s.icon}</div><div>${s.name}</div>`;box.appendChild(d)}}
function hydrateDrawDisplayOnce(){const session=state?.gameSessionId;if(!session||drawDisplaySession===session)return;drawDisplaySession=session;showCards(me?.lastDraw||[],true)}
async function onDraw(m){if(m.playerId!==me.id)return;drawDisplaySession=state?.gameSessionId||drawDisplaySession;revealBusy=true;$('#drawBtn').disabled=true;clearDrawDisplay();for(const id of m.cards){await new Promise(r=>setTimeout(r,500));showCards([id],false)}if(m.crossedRed)pop('上位突入！');if(m.autoEligible&&autoRecord()){recordSpin(m.machine,m.cards)}else{recordSpin(m.machine,[])}yellowArmed=false;revealBusy=false;renderDrawControls();renderRoundTransition();saveNotes()}
function autoRecord(){return localStorage.getItem('sss_auto_record')==='1'}
function recordSpin(machine,cards){ensureNotes();const counts={};for(const s of SYMBOLS)counts[s.id]=0;for(const c of cards)counts[c]=(counts[c]||0)+1;notebooks[machine].spins.push(counts);currentNoteMachine=machine;$('#noteMachineSelect').value=machine;saveNotes();renderNotebook()}
function renderNotebook(){if(!me)return;ensureNotes();const sel=$('#noteMachineSelect');if(!sel.options.length){sel.innerHTML=['A','B','C','D','E','F'].map(m=>`<option>${m}</option>`).join('');sel.onchange=()=>{currentNoteMachine=sel.value;renderNotebook()}}sel.value=currentNoteMachine;const sh=notebooks[currentNoteMachine];$('#predictionRow').innerHTML='<b>予測設定</b>'+[1,2,3,4,5,6].map(n=>`<button class="pred ${sh.pred.includes(n)?'on':''}" data-p="${n}">${n}</button>`).join('');$('#predictionRow').querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{const n=+b.dataset.p;sh.pred=sh.pred.includes(n)?sh.pred.filter(x=>x!==n):[...sh.pred,n];saveNotes();renderNotebook()});const cols=Math.max(12,sh.spins.length);let html=`<div class="note-grid" style="--cols:${cols}"><div class="note-head">シンボル</div><div class="note-head">累計</div>`;for(let c=0;c<cols;c++)html+=`<div class="note-head">${c+1}</div>`;for(const sym of SYMBOLS){const total=sh.spins.reduce((a,x)=>a+(x[sym.id]||0),0);html+=`<div class="note-cell note-symbol">${sym.icon}${sym.noteName?` ${sym.noteName}`:''}</div><div class="note-cell note-total">${total}</div>`;for(let c=0;c<cols;c++){const val=sh.spins[c]?.[sym.id]||0;html+=`<div class="note-cell note-square ${deleteMode?'delete-target':''}" data-s="${sym.id}" data-c="${c}"><span>${val||''}</span></div>`}}html+='</div>';$('#notebook').innerHTML=html;$('#notebook').querySelectorAll('.note-square').forEach(cell=>cell.onclick=()=>editNoteCell(cell));$('#deleteModeBtn').classList.toggle('delete-on',deleteMode)}
function editNoteCell(cell){const sh=notebooks[currentNoteMachine], c=+cell.dataset.c,s=cell.dataset.s;while(sh.spins.length<=c){const o={};SYMBOLS.forEach(x=>o[x.id]=0);sh.spins.push(o)}if(deleteMode){sh.spins[c][s]=0;deleteMode=false}else{sh.spins[c][s]=(sh.spins[c][s]||0)+1}saveNotes();renderNotebook()}
function renderFinalAnswer(){const a=$('#finalAnswerArea');a.classList.toggle('hidden',state.phase!=='final_answer');if(state.phase!=='final_answer')return;if(finalDraftSession!==state.gameSessionId){finalAnswerDraft={...(me.finalAnswer||{})};finalDraftSession=state.gameSessionId}const ans=finalAnswerDraft||{};a.innerHTML='<h2>最終回答</h2><p>設定1～6を1回ずつ使ってください。同じ数字がある場合は赤表示します。</p>'+['A','B','C','D','E','F'].map(m=>`<div class="answer-row" data-r="${m}"><b>${m}台</b><select data-m="${m}"><option value="">--</option>${[1,2,3,4,5,6].map(n=>`<option value="${n}" ${Number(ans[m])===n?'selected':''}>設定${n}</option>`).join('')}</select></div>`).join('')+'<button id="submitAnswer" class="primary wide">最終回答を確定</button>';a.querySelectorAll('select').forEach(sel=>sel.onchange=()=>{finalAnswerDraft[sel.dataset.m]=sel.value?Number(sel.value):null;checkDupAnswers()});$('#submitAnswer').onclick=submitFinal;checkDupAnswers()}
function checkDupAnswers(){const vals=[...$('#finalAnswerArea').querySelectorAll('select')].map(s=>s.value).filter(Boolean);const dup=new Set(vals.filter((v,i,a)=>a.indexOf(v)!==i));$('#finalAnswerArea').querySelectorAll('.answer-row').forEach(r=>r.classList.toggle('dup',dup.has(r.querySelector('select').value)));return dup.size===0&&vals.length===6}
async function submitFinal(){if(!checkDupAnswers())return toast('設定1～6を1回ずつ選んでください');const answer={};$('#finalAnswerArea').querySelectorAll('select').forEach(s=>answer[s.dataset.m]=+s.value);const r=await action('finalAnswer',{answer});if(r?.ok)finalAnswerDraft={...answer}}
function renderResult(){const a=$('#resultArea');a.classList.toggle('hidden',state.phase!=='result');if(state.phase!=='result')return;const mine=state.results?.find(x=>x.id===me.id);a.innerHTML=`<h2>RESULT</h2><h1>${mine?.score??0} / 6 点</h1><table><tr><th>台</th><th>正解</th><th>回答</th></tr>${['A','B','C','D','E','F'].map(m=>`<tr class="${mine?.answer?.[m]===state.solution?.[m]?'correct':'wrong'}"><td>${m}</td><td>設定${state.solution?.[m]}</td><td>${mine?.answer?.[m]?`設定${mine.answer[m]}`:'-'}</td></tr>`).join('')}</table><h3>${(state.winners||[]).map(esc).join(' / ')} 勝利</h3>${me.isHost?'<button id="backLobby" class="primary">ロビーへ戻る</button>':''}`;$('#backLobby')?.addEventListener('click',()=>action('backLobby',{}))}
async function action(type,payload={}){try{const commonTypes=new Set(['settings','start','reset']);const actionId=commonTypes.has(type)?newActionId(type):undefined;return await api(`/api/room/${roomId}/action`,{method:'POST',body:JSON.stringify({token,type,...payload,...(actionId?{actionId}:{})})})}catch(e){toast(e.message)}}
function renderRoundTransition(){
 const modal=$('#roundEndModal');
 if(!state||state.phase!=='round_end'||me?.roundEndAcked||revealBusy){modal.classList.add('hidden');return}
 $('#roundEndMessage').textContent=`ラウンド${state.round}終了、シンキングタイムへ`;
 modal.classList.remove('hidden');
}
async function acknowledgeRoundEnd(){
 $('#roundEndModal').classList.add('hidden');
 try{await action('ackRoundEnd',{})}catch(e){toast(e.message);renderRoundTransition()}
}
function startTimer(){clearInterval(localTimer);const tick=()=>{if(!state?.deadline){$('#timer').textContent='--:--';return}const ms=Math.max(0,state.deadline-Date.now()),sec=Math.ceil(ms/1000);$('#timer').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`};tick();localTimer=setInterval(tick,250)}
function openMove(){if(state.moveLocked)return;action('beginMove',{}).then(r=>{if(r?.ok)showMoveModal(r.available)})}
function showMoveModal(av){$('#modalBody').innerHTML='<h3>移動先を選択</h3><div class="machine-select">'+['A','B','C','D','E','F'].map(m=>`<button class="machine-btn" data-m="${m}" ${av.includes(m)?'':'disabled'}>${m}${av.includes(m)?'':'<br>使用中'}</button>`).join('')+'</div>';$('#modal').classList.remove('hidden');$('#modalBody').querySelectorAll('[data-m]:not(:disabled)').forEach(b=>b.onclick=async()=>{await action('finishMove',{machine:b.dataset.m});closeModal()})}
function closeModal(){if(state?.moveLocked&&state.moveLockId===me?.id)action('cancelMove',{});$('#modal').classList.add('hidden')}
function openMemo(){ensureNotes();const sh=notebooks[currentNoteMachine];$('#modalBody').innerHTML=`<h3>${currentNoteMachine}台 非公開メモ</h3><textarea id="memoText">${esc(sh.memo||'')}</textarea><button id="saveMemo" class="primary">保存</button>`;$('#modal').classList.remove('hidden');$('#saveMemo').onclick=()=>{sh.memo=$('#memoText').value;saveNotes();$('#modal').classList.add('hidden')}}
async function leave(){if(roomId&&token)try{await api(`/api/room/${roomId}/leave`,{method:'POST',body:JSON.stringify({token})})}catch{}leaveLocal();loadRooms()}
function leaveLocal(){localStorage.removeItem(ACTIVE_ROOM_KEY);localStorage.removeItem(ACTIVE_NAME_KEY);roomId=null;token=null;state=null;me=null;lobbySettingsDraft=null;lobbySettingsDirty=false;lobbySettingsRoom=null;drawDisplaySession=null;clearDrawDisplay();if(ws)try{ws.close()}catch{};ws=null;$('#leaveBtn').classList.add('hidden');setView('titleView');$('#phaseMini').textContent=''}
['#investigateSec','#thinkingSec','#finalThinkingSec'].forEach(id=>$(id).addEventListener('input',markLobbySettingsDirty));
$('#startBtn').onclick=()=>{const cfg=readLobbySettingsDraft();lobbySettingsDraft=cfg;return action('start',cfg)};
$('#forceEndBtn').onclick=()=>confirm('ゲームを強制終了しますか？')&&action('forceEnd',{});
$('#resetBtn').onclick=()=>confirm('ROOMを完全に初期化しますか？')&&action('reset',{});
$('#leaveBtn').onclick=leave;
$('#moveBtn').onclick=openMove;
$('#memoBtn').onclick=openMemo;
$('#modalClose').onclick=closeModal;$('#roundEndOk').onclick=acknowledgeRoundEnd;
$('#deleteModeBtn').onclick=()=>{deleteMode=!deleteMode;renderNotebook()};
$('#autoRecordToggle').onchange=e=>localStorage.setItem('sss_auto_record',e.target.checked?'1':'0');
$('#yellowBtn').onclick=()=>{if(me.yellow>0){yellowArmed=!yellowArmed;renderDrawControls()}};
$('#drawBtn').onclick=async()=>{if(revealBusy)return;revealBusy=true;renderDrawControls();try{await action('draw',{useYellow:yellowArmed})}finally{setTimeout(()=>{if(revealBusy){revealBusy=false;renderDrawControls()}},9000)}};
$('#nameInput').value=loadName();$('#nameInput').addEventListener('input',e=>sessionStorage.setItem(NAME_DRAFT_KEY,e.target.value));$('#refreshRoomsBtn').onclick=loadRooms;document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&roomId&&(!ws||ws.readyState!==WebSocket.OPEN))scheduleReconnect()});window.addEventListener('online',scheduleReconnect);async function boot(){await loadRooms();const ar=localStorage.getItem(ACTIVE_ROOM_KEY),an=localStorage.getItem(ACTIVE_NAME_KEY);if(ar&&ROOM_IDS.includes(ar)&&an&&localStorage.getItem(sessionKey(ar))){$('#nameInput').value=an;await joinRoom(ar,an)}}boot();

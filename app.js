let mobileSheetView='record';
'use strict';
const VERSION='0.1.24';
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
let yellowArmed=false, deleteMode=false, revealBusy=false, localTimer=null, timerAnchor=null;
let revealSeenSession=null, revealSeen=new Set();
// 抽選結果DOMは通常のstate再描画から分離する。再接続時だけlastDrawを1回復元する。
let drawDisplaySession=null;
// ロビー設定は保存せず、この画面で編集中のDraftだけ保持する。
let lobbySettingsDraft=null, lobbySettingsDirty=false, lobbySettingsRoom=null;
let notebooks={}, currentNoteMachine='A', notebookSessionId=null, lastMeMachine=null;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function toast(t){const e=$('#toast');e.textContent=t;e.classList.remove('hidden');setTimeout(()=>e.classList.add('hidden'),2200)}
function pop(t,ms=1800){const e=$('#bigPop');e.textContent=t;e.classList.remove('hidden');clearTimeout(pop._timer);pop._timer=setTimeout(()=>e.classList.add('hidden'),ms)}
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
function phaseLabel(p){return ({empty:'空室',lobby:'待機中',ticket:'抽選券選択',ticket_reveal:'抽選券公開',machine_select:'台選択',investigate_ready:'調査開始待ち',investigate:'調査中',round_end:'ラウンド終了',thinking:'シンキング',final_thinking_ready:'最終シンキング開始待ち',final_thinking:'最終シンキング',answer_reveal_ready:'答え合わせ待ち',answer_reveal:'答え合わせ',result:'結果'})[p]||p}
async function checkRoomJoin(r,name,t){const q=new URLSearchParams({roomId:r,name,token:t});return api(`/join-check?${q.toString()}`,{method:'GET'})}
async function joinRoom(r,forcedName=null){const name=String(forcedName??getName()).trim();if(!name)return toast('名前を入力してください');const t=getOrCreateToken(r);try{await checkRoomJoin(r,name,t);const d=await api(`/api/room/${r}/join`,{method:'POST',body:JSON.stringify({name,token:t})});roomId=r;token=d.token||t;localStorage.setItem(sessionKey(r),token);localStorage.setItem(ACTIVE_ROOM_KEY,r);localStorage.setItem(ACTIVE_NAME_KEY,name);$('#nameInput').value=name;await fetchState();connectWs();$('#leaveBtn').classList.remove('hidden')}catch(e){toast(e.message)}}
async function fetchState(){if(!roomId||!token)return;state=await api(`/api/room/${roomId}/state?token=${encodeURIComponent(token)}`);onState(state)}
function connectWs(){if(ws)try{ws.close()}catch{};const u=SERVER_URL.replace(/^http/,'ws')+`/api/room/${roomId}/ws?token=${encodeURIComponent(token)}`;ws=new WebSocket(u);ws.onmessage=ev=>{try{const m=JSON.parse(ev.data);if(m.type==='state')onState(m.state);if(m.type==='draw')onDraw(m);if(m.type==='upperEntry')pop(`${m.playerName} 上位突入！`,1000)}catch{}};ws.onclose=()=>{if(roomId)setTimeout(connectWs,1300)}}
function scheduleReconnect(){if(roomId&&(!ws||ws.readyState!==WebSocket.OPEN))setTimeout(()=>{if(roomId)connectWs()},250)}
function onState(s){const prevSession=state?.gameSessionId;state=s;me=s.me;syncTimerAnchor(s);if(s.gameSessionId&&notebookSessionId!==s.gameSessionId){notebooks=loadNotes();ensureNotes();notebookSessionId=s.gameSessionId;currentNoteMachine=me?.machine||'A';lastMeMachine=me?.machine||null;finalAnswerDraft=null;finalDraftSession=null;drawDisplaySession=null;mobileSheetView='record';clearDrawDisplay()}else if(me?.machine&&me.machine!==lastMeMachine){currentNoteMachine=me.machine;lastMeMachine=me.machine}if(prevSession&&s.gameSessionId!==prevSession){finalAnswerDraft=null;finalDraftSession=null;drawDisplaySession=null;mobileSheetView='record';clearDrawDisplay()}if(s.gameSessionId&&s.phase!=='lobby'&&s.phase!=='empty'){const k='sss_saved_common_name_'+s.gameSessionId;if(!sessionStorage.getItem(k)){saveCommonNameOnActualStart(me?.name);sessionStorage.setItem(k,'1')}}if(!['final_thinking','answer_reveal_ready','answer_reveal'].includes(s.phase)){finalAnswerDraft=null;finalDraftSession=null}$('#phaseMini').textContent=`R${s.round||'-'} ${phaseLabel(s.phase)}`;if(s.phase==='lobby'){setView('lobbyView');renderLobby();drawDisplaySession=null;clearDrawDisplay()}else if(s.phase==='empty'){leaveLocal();return}else{setView('gameView');renderPhaseModals();renderGame();hydrateDrawDisplayOnce()}
startTimer()}
function renderLobby(){$('#roomNo').textContent=String(roomId).replace('room','');$('#lobbyPlayers').innerHTML=state.players.map(p=>`<div class="player-card ${p.id===me.id?'me':''}"><b>${esc(p.name)}</b><span>${p.isHost?'HOST':''}</span></div>`).join('');const host=me.isHost;$('#hostSettings').classList.toggle('hidden',!host);if(host){if(lobbySettingsRoom!==roomId||!lobbySettingsDraft){lobbySettingsRoom=roomId;lobbySettingsDraft={investigateSec:state.settings.investigateSec,thinkingSec:state.settings.thinkingSec,finalThinkingSec:state.settings.finalThinkingSec,roundCount:state.settings.roundCount||4,gameMode:state.settings.gameMode||'normal',autoRecord:state.settings.autoRecord===true};lobbySettingsDirty=false}if(!lobbySettingsDirty){lobbySettingsDraft={investigateSec:state.settings.investigateSec,thinkingSec:state.settings.thinkingSec,finalThinkingSec:state.settings.finalThinkingSec,roundCount:state.settings.roundCount||4,gameMode:state.settings.gameMode||'normal',autoRecord:state.settings.autoRecord===true}}writeLobbySettingsDraft()}}
function writeLobbySettingsDraft(){if(!lobbySettingsDraft)return;$('#investigateSec').value=lobbySettingsDraft.investigateSec;$('#thinkingSec').value=lobbySettingsDraft.thinkingSec;$('#finalThinkingSec').value=lobbySettingsDraft.finalThinkingSec;$('#roundCount').value=lobbySettingsDraft.roundCount||4;$('#gameMode').value=lobbySettingsDraft.gameMode||'normal';$('#autoRecordToggle').checked=lobbySettingsDraft.autoRecord===true}
function readLobbySettingsDraft(){return {investigateSec:+$('#investigateSec').value,thinkingSec:+$('#thinkingSec').value,finalThinkingSec:+$('#finalThinkingSec').value,roundCount:+$('#roundCount').value,gameMode:$('#gameMode').value,autoRecord:$('#autoRecordToggle').checked}}
function markLobbySettingsDirty(){if(!me?.isHost)return;lobbySettingsDraft=readLobbySettingsDraft();lobbySettingsDirty=true}
function renderGame(){document.body.classList.toggle('final-thinking-mode',state.phase==='final_thinking');document.body.classList.toggle('result-mode',state.phase==='result');renderPlayers();$('#roundInfo').innerHTML=`<b>ラウンド ${state.round}/${state.settings?.roundCount||4}</b>${state.settings?.gameMode==='coop'?' <span class="mode-badge">協力</span>':''}<br>${phaseLabel(state.phase)}${state.selectTurnName?`<br>選択：${esc(state.selectTurnName)}`:''}`;$('#machineBox').innerHTML=`現在台：<b>${me.machine||'なし'}</b>${me.ticket!=null?`<br>抽選券：${me.ticket}`:''}`;$('#moveBtn').disabled=state.phase!=='investigate'||!me.machine||state.moveLocked;$('#moveBtn').textContent=state.moveLocked?`${state.moveLockName||'誰か'}が台移動中`:'台移動';renderEarlyFinalButton();renderTicket();renderMachineSelect();renderDrawControls();renderNotebook();renderSheetTabs();renderFinalAnswer();renderAnswerReveal();renderResult()}

function renderEarlyFinalButton(){
 const b=$('#earlyFinalBtn');
 const top=$('#earlyFinalTopBtn');
 const allowed=['machine_select','investigate_ready','investigate','round_end','thinking'].includes(state?.phase);
 const show=!!(me?.isHost&&allowed);
 b.classList.toggle('hidden',!show);
 b.disabled=false;
 if(top){top.classList.toggle('hidden',!show);top.disabled=false;}
}
async function goEarlyFinalThinking(){
 if(!me?.isHost)return;
 if(!confirm('最終シンキングタイムへ移りますか？'))return;
 const b=$('#earlyFinalBtn'),top=$('#earlyFinalTopBtn');
 b.disabled=true;if(top)top.disabled=true;
 const r=await action('goFinalThinkingReady',{});
 if(!r?.ok){b.disabled=false;if(top)top.disabled=false;}
}

function renderPhaseModals(){
  // 重要フェーズのモーダルは通常盤面描画より先に更新する。
  // 記録用紙など別UIで例外が起きても、進行確認ボックスだけは必ず表示する。
  renderInvestigateReady();
  renderRoundTransition();
  renderFinalThinkingReady();
  renderAnswerRevealReady();
}
function renderPlayers(){const h=state.players.map(p=>`<div class="player-card ${p.id===me.id?'me':''} ${p.red?'red':''}"><b>${esc(p.name)}</b><span>🔔${p.publicBell}　🟡${p.publicYellow}${p.red?'　🔴':''}</span></div>`).join('');$('#playersGame').innerHTML=h}
function renderTicket(){
 const a=$('#ticketArea');
 const on=['ticket','ticket_reveal'].includes(state.phase);
 a.classList.toggle('hidden',!on);if(!on)return;
 const owners=state.ticketOwners||{}, reveal=state.ticketReveal||{};
 const myTurn=state.phase==='ticket'&&state.ticketTurnId===me.id;
 const head=state.phase==='ticket_reveal'?'全員選択完了 ― 一斉公開！':(myTurn?'あなたの番です':`${esc(state.ticketTurnName||'')} の選択待ち`);
 a.innerHTML=`<div class="ticket-guide">${head}</div>`+state.ticketSlots.map((_,i)=>{const owner=owners[i]||'';const picked=!!owner;const shown=state.phase==='ticket_reveal'&&reveal[i]!=null;return `<button class="ticket ticket-card ${picked?'picked':''} ${shown?'revealed':''}" data-i="${i}" ${!myTurn||picked||state.phase!=='ticket'?'disabled':''}><span class="ticket-inner"><span class="ticket-front"><b>?</b>${picked?`<small>${esc(owner)}</small>`:''}</span><span class="ticket-back"><b>${shown?reveal[i]:'?'}</b><small>${esc(owner)}</small></span></span></button>`}).join('');
 a.querySelectorAll('button:not(:disabled)').forEach(b=>b.onclick=()=>action('pickTicket',{slot:+b.dataset.i}))
}
function renderMachineSelect(){const a=$('#machineSelectArea');const initial=state.phase==='machine_select';const rejoin=['investigate_ready','investigate'].includes(state.phase)&&!me.machine&&state.rejoinSelectTurnId;const on=initial||rejoin;a.classList.toggle('hidden',!on);if(!on)return;const mine=initial?state.selectTurnId===me.id:state.rejoinSelectTurnId===me.id;const waitingName=initial?state.selectTurnName:state.rejoinSelectTurnName;const occ=new Map(state.players.filter(p=>p.machine).map(p=>[p.machine,p.name]));a.innerHTML=`<div style="grid-column:1/-1;text-align:center">${mine?(rejoin?'再入場：台を選んでください':'台を選んでください'):`${esc(waitingName||'')} の選択待ち`}</div>`+['A','B','C','D','E','F'].map(m=>`<button class="machine-btn ${occ.has(m)?'occupied':''}" data-m="${m}" ${!mine||occ.has(m)?'disabled':''}>${m}${occ.has(m)?`<br>${esc(occ.get(m))}使用中`:''}</button>`).join('');a.querySelectorAll('[data-m]').forEach(b=>b.onclick=()=>action(rejoin?'selectRejoinMachine':'selectMachine',{machine:b.dataset.m}))}
function renderDrawControls(){const show=['investigate','round_end','thinking'].includes(state.phase);$('#drawArea').classList.toggle('hidden',!show);$('#drawBtn').disabled=state.phase!=='investigate'||!me.machine||revealBusy;$('#yellowBtn').disabled=state.phase!=='investigate'||me.yellow<=0||revealBusy;$('#yellowBtn').textContent=`目押し ×${me.yellow}`;$('#yellowBtn').classList.toggle('active',yellowArmed);$('#bonusInfo').innerHTML=`ボーナスカウント 🔔 <b>${me.bell}</b>　<span class="yellow-chip">🟡 ${me.yellow}</span>　${me.red?'<span class="red-chip">🔴 上位突入 / 4枚抽選</span>':'通常3枚抽選'}`;}
function symbolDef(id){return SYMBOLS.find(x=>x.id===id)||{name:id,icon:'?'}}
function clearDrawDisplay(){$('#drawCards').replaceChildren()}
function showCards(ids,clear=true){const box=$('#drawCards');if(clear)box.replaceChildren();for(const id of ids){const s=symbolDef(id);const d=document.createElement('div');d.className='slot-card';d.innerHTML=`<div class="icon">${s.icon}</div><div>${s.name}</div>`;box.appendChild(d)}}
function hydrateDrawDisplayOnce(){const session=state?.gameSessionId;if(!session||drawDisplaySession===session)return;drawDisplaySession=session;showCards(me?.lastDraw||[],true)}
async function onDraw(m){if(m.playerId!==me.id)return;drawDisplaySession=state?.gameSessionId||drawDisplaySession;revealBusy=true;$('#drawBtn').disabled=true;clearDrawDisplay();for(const id of m.cards){await new Promise(r=>setTimeout(r,500));showCards([id],false)}if(m.autoEligible&&autoRecord()){recordSpin(m.machine,m.cards)}else{recordSpin(m.machine,[])}yellowArmed=false;revealBusy=false;renderDrawControls();renderRoundTransition();saveNotes()}
function autoRecord(){return state?.settings?.autoRecord===true}
function recordSpin(machine,cards){ensureNotes();const counts={};for(const s of SYMBOLS)counts[s.id]=0;for(const c of cards)counts[c]=(counts[c]||0)+1;notebooks[machine].spins.push(counts);currentNoteMachine=machine;$('#noteMachineSelect').value=machine;saveNotes();renderNotebook()}
function renderSheetTabs(){
 const pane=$('#rightPane');
 const record=$('#recordTabBtn'),ref=$('#referenceTabBtn');
 if(!pane||!record||!ref)return;
 const showRef=mobileSheetView==='reference';
 pane.classList.toggle('show-reference',showRef);
 record.classList.toggle('active',!showRef);
 ref.classList.toggle('active',showRef);
}
function setSheetView(view){mobileSheetView=view==='reference'?'reference':'record';renderSheetTabs()}
function renderNotebook(){if(!me)return;ensureNotes();const sel=$('#noteMachineSelect');if(!sel.options.length){sel.innerHTML=['A','B','C','D','E','F'].map(m=>`<option>${m}</option>`).join('');sel.onchange=()=>{currentNoteMachine=sel.value;renderNotebook()}}sel.value=currentNoteMachine;const sh=notebooks[currentNoteMachine];$('#predictionRow').innerHTML='<b>予測設定</b>'+[1,2,3,4,5,6].map(n=>`<button class="pred ${sh.pred.includes(n)?'on':''}" data-p="${n}">${n}</button>`).join('');$('#predictionRow').querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{const n=+b.dataset.p;sh.pred=sh.pred.includes(n)?sh.pred.filter(x=>x!==n):[...sh.pred,n];saveNotes();renderNotebook()});const cols=Math.max(12,sh.spins.length);let html=`<div class="note-grid" style="--cols:${cols}"><div class="note-head">シンボル</div><div class="note-head">累計</div>`;for(let c=0;c<cols;c++)html+=`<div class="note-head">${c+1}</div>`;for(const sym of SYMBOLS){const total=sh.spins.reduce((a,x)=>a+(x[sym.id]||0),0);html+=`<div class="note-cell note-symbol">${sym.icon}${sym.noteName?` ${sym.noteName}`:''}</div><div class="note-cell note-total">${total}</div>`;for(let c=0;c<cols;c++){const val=sh.spins[c]?.[sym.id]||0;html+=`<div class="note-cell note-square ${deleteMode?'delete-target':''}" data-s="${sym.id}" data-c="${c}"><span>${val||''}</span></div>`}}html+='</div>';$('#notebook').innerHTML=html;$('#notebook').querySelectorAll('.note-square').forEach(cell=>cell.onclick=()=>editNoteCell(cell));$('#deleteModeBtn').classList.toggle('delete-on',deleteMode)}
function editNoteCell(cell){const sh=notebooks[currentNoteMachine], c=+cell.dataset.c,s=cell.dataset.s;while(sh.spins.length<=c){const o={};SYMBOLS.forEach(x=>o[x.id]=0);sh.spins.push(o)}if(deleteMode){sh.spins[c][s]=0;deleteMode=false}else{sh.spins[c][s]=(sh.spins[c][s]||0)+1}saveNotes();renderNotebook()}
function renderFinalAnswer(){const a=$('#finalAnswerArea');a.classList.toggle('hidden',state.phase!=='final_thinking');if(state.phase!=='final_thinking')return;if(finalDraftSession!==state.gameSessionId){finalAnswerDraft={...(me.finalAnswer||{})};finalDraftSession=state.gameSessionId}const ans=finalAnswerDraft||{};const confirmed=me.finalConfirmed===true;const count=Number(state.finalConfirmCount||0),total=Number(state.finalConfirmTotal||state.players?.length||0);a.innerHTML='<h2>最終回答</h2><p>設定1～6を割り当ててください。同じ数字は赤表示になり、答え合わせではその重複箇所が空欄扱いになります。</p>'+['A','B','C','D','E','F'].map(m=>`<div class="answer-row" data-r="${m}"><b>${m}台</b><select data-m="${m}" ${confirmed?'disabled':''}><option value="">--</option>${[1,2,3,4,5,6].map(n=>`<option value="${n}" ${Number(ans[m])===n?'selected':''}>設定${n}</option>`).join('')}</select></div>`).join('')+`<div class="final-confirm-wrap"><button id="finalAnswerConfirmBtn" class="primary" ${confirmed?'disabled':''}>${confirmed?'確定済み':'回答確定'}</button><span class="final-confirm-count">確定 ${count} / ${total}</span></div>`;a.querySelectorAll('select').forEach(sel=>sel.onchange=()=>{if(confirmed)return;finalAnswerDraft[sel.dataset.m]=sel.value?Number(sel.value):null;checkDupAnswers();queueFinalAnswerSave();updateFinalConfirmButton()});checkDupAnswers();updateFinalConfirmButton();$('#finalAnswerConfirmBtn')?.addEventListener('click',confirmFinalAnswer)}
function checkDupAnswers(){const vals=[...$('#finalAnswerArea').querySelectorAll('select')].map(s=>s.value).filter(Boolean);const dup=new Set(vals.filter((v,i,x)=>x.indexOf(v)!==i));$('#finalAnswerArea').querySelectorAll('.answer-row').forEach(r=>r.classList.toggle('dup',dup.has(r.querySelector('select').value)));return dup}
let finalSaveTimer=null;
function queueFinalAnswerSave(){clearTimeout(finalSaveTimer);if(state?.phase==='final_thinking'&&finalAnswerDraft)action('finalAnswer',{answer:{...finalAnswerDraft}})}
function updateFinalConfirmButton(){const b=$('#finalAnswerConfirmBtn');if(!b||me?.finalConfirmed)return;const complete=['A','B','C','D','E','F'].every(m=>Number(finalAnswerDraft?.[m])>=1&&Number(finalAnswerDraft?.[m])<=6);b.disabled=!complete}
async function confirmFinalAnswer(){const b=$('#finalAnswerConfirmBtn');if(!b||b.disabled||me?.finalConfirmed)return;const complete=['A','B','C','D','E','F'].every(m=>Number(finalAnswerDraft?.[m])>=1&&Number(finalAnswerDraft?.[m])<=6);if(!complete){toast('A～Fすべての回答を入力してください');return}clearTimeout(finalSaveTimer);b.disabled=true;const r=await action('confirmFinalAnswer',{answer:{...finalAnswerDraft}});if(!r?.ok&&state?.phase==='final_thinking'&&!me?.finalConfirmed)b.disabled=false}


function renderFinalThinkingReady(){const modal=$('#finalThinkingReadyModal');if(!state||state.phase!=='final_thinking_ready'){modal.classList.add('hidden');return}const btn=$('#finalThinkingStartBtn'),wait=$('#finalThinkingWait');if(me?.isHost){btn.classList.remove('hidden');wait.classList.add('hidden');btn.disabled=false}else{btn.classList.add('hidden');wait.classList.remove('hidden')}modal.classList.remove('hidden')}
async function startFinalThinking(){const b=$('#finalThinkingStartBtn');b.disabled=true;const r=await action('startFinalThinking',{});if(!r?.ok&&state?.phase==='final_thinking_ready')b.disabled=false}
function renderAnswerRevealReady(){const modal=$('#answerRevealReadyModal');if(!state||state.phase!=='answer_reveal_ready'){modal.classList.add('hidden');return}const btn=$('#answerRevealStartBtn'),wait=$('#answerRevealWait');if(me?.isHost){btn.classList.remove('hidden');wait.classList.add('hidden');btn.disabled=false}else{btn.classList.add('hidden');wait.classList.remove('hidden')}modal.classList.remove('hidden')}
async function startAnswerReveal(){const b=$('#answerRevealStartBtn');b.disabled=true;const r=await action('startAnswerReveal',{});if(!r?.ok&&state?.phase==='answer_reveal_ready')b.disabled=false}
function renderAnswerReveal(){const revealOn=state?.phase==='answer_reveal';const keepPred=['answer_reveal','result'].includes(state?.phase);const board=$('#answerRevealBoard'),pane=$('#rightPane'),pred=$('#revealPredictionsPanel');board.classList.toggle('hidden',!revealOn);pane.classList.toggle('reveal-mode',keepPred);pred.classList.toggle('hidden',!keepPred);if(!keepPred)return;if(revealSeenSession!==state.gameSessionId){revealSeenSession=state.gameSessionId;revealSeen=new Set()}const revealed=state.revealedSolutions||{};if(revealOn)board.innerHTML=['A','B','C','D','E','F'].map(m=>{const is=Number.isFinite(Number(revealed[m]));const seen=revealSeen.has(m);return `<button class="answer-reveal-card ${is&&seen?'flipped':''}" data-machine="${m}" ${!me.isHost||is?'disabled':''}><span class="reveal-card-inner"><span class="reveal-card-front">${m}</span><span class="reveal-card-back">設定${is?revealed[m]:'?'}</span></span></button>`}).join('');for(const m of ['A','B','C','D','E','F']){if(revealed[m]!=null&&!revealSeen.has(m)){const el=board.querySelector(`[data-machine="${m}"]`);requestAnimationFrame(()=>requestAnimationFrame(()=>el?.classList.add('flipped')));revealSeen.add(m)}}board.querySelectorAll('[data-machine]:not(:disabled)').forEach(b=>b.onclick=()=>{b.disabled=true;action('revealMachine',{machine:b.dataset.machine})});const rows=state.answerPredictions||[];const coop=state.settings?.gameMode==='coop'&&state.coopAnswer?{name:'協力最終回答',answer:state.coopAnswer,coop:true}:null;const displayRows=coop?[...rows,coop]:rows;pred.innerHTML=`<div class="reveal-pred-title">${state.settings?.gameMode==='coop'?'全プレイヤーの予測 / 協力最終回答':'全プレイヤーの予測'}</div><div class="reveal-pred-grid"><div class="rp-head">プレイヤー</div>${['A','B','C','D','E','F'].map(m=>`<div class="rp-head">${m}</div>`).join('')}${displayRows.map(r=>`<div class="rp-name ${r.coop?'coop-row':''}">${esc(r.name)}</div>${['A','B','C','D','E','F'].map(m=>`<div class="rp-cell ${r.coop?'coop-row':''}">${r.answer?.[m]?r.answer[m]:'-'}</div>`).join('')}`).join('')}</div>`}

function renderResult(){const a=$('#resultArea');a.classList.toggle('hidden',state.phase!=='result');if(state.phase!=='result')return;const results=[...(state.results||[])].sort((x,y)=>y.score-x.score);if(state.settings?.gameMode==='coop'){const score=Number(state.coopScore||0);a.innerHTML=`<div class="winner-banner">協力結果 ${score} / 6点</div><div class="score-list"><div class="score-head">プレイヤー</div><div class="score-head">個人正解数</div>${results.map(r=>`<div class="score-name">${esc(r.name)}</div><div class="score-value">${r.score} / 6</div>`).join('')}</div>${me.isHost?'<button id="backLobby" class="primary">ロビーへ戻る</button>':''}`;}else{const winners=state.winners||[];const winText=winners.length>1?`${winners.map(esc).join(' / ')} 同率勝利！`:`${esc(winners[0]||'')} 勝利！`;a.innerHTML=`<div class="winner-banner">${winText}</div><div class="score-list"><div class="score-head">プレイヤー</div><div class="score-head">得点</div>${results.map(r=>`<div class="score-name ${winners.includes(r.name)?'winner':''}">${esc(r.name)}</div><div class="score-value ${winners.includes(r.name)?'winner':''}">${r.score} / 6</div>`).join('')}</div>${me.isHost?'<button id="backLobby" class="primary">ロビーへ戻る</button>':''}`;}$('#backLobby')?.addEventListener('click',()=>action('backLobby',{}))}
async function action(type,payload={}){try{const commonTypes=new Set(['settings','start','startInvestigate','goFinalThinkingReady','startFinalThinking','confirmFinalAnswer','startAnswerReveal','reset']);const actionId=commonTypes.has(type)?newActionId(type):undefined;return await api(`/api/room/${roomId}/action`,{method:'POST',body:JSON.stringify({token,type,...payload,...(actionId?{actionId}:{})})})}catch(e){toast(e.message)}}

function renderInvestigateReady(){
 const modal=$('#investigateReadyModal');
 if(!state||state.phase!=='investigate_ready'){modal.classList.add('hidden');return}
 const missing=(state.players||[]).filter(p=>p.connected&&!p.machine);
 // 再接続者など、台未選択のプレイヤーが1人でもいる間は台選択を最優先する。
 // この状態で調査開始ボタンを出すと進行不能になるため、準備完了BOX自体を出さない。
 if(missing.length){modal.classList.add('hidden');return}
 $('#investigateReadyMessage').textContent=`ラウンド${state.round}：全員の台選択が完了しました`;
 const btn=$('#investigateStartBtn');
 const wait=$('#investigateReadyWait');
 if(me?.isHost){btn.classList.remove('hidden');wait.classList.add('hidden');btn.disabled=false}else{btn.classList.add('hidden');wait.classList.remove('hidden')}
 modal.classList.remove('hidden');
}
async function startInvestigation(){
 const btn=$('#investigateStartBtn');
 btn.disabled=true;
 const r=await action('startInvestigate',{});
 if(!r?.ok&&state?.phase==='investigate_ready')btn.disabled=false;
}

function renderRoundTransition(){
 const modal=$('#roundEndModal');
 if(!state||state.phase!=='round_end'||revealBusy){modal.classList.add('hidden');return}
 $('#roundEndMessage').textContent=`ラウンド${state.round}終了、シンキングタイムへ`;
 const btn=$('#roundEndOk'),wait=$('#roundEndWait');
 if(me?.isHost){btn.classList.remove('hidden');wait.classList.add('hidden');btn.disabled=false}
 else{btn.classList.add('hidden');wait.classList.remove('hidden')}
 modal.classList.remove('hidden');
}
async function acknowledgeRoundEnd(){
 if(!me?.isHost)return;
 const b=$('#roundEndOk');
 b.disabled=true;
 try{
  const r=await action('ackRoundEnd',{});
  if(!r?.ok&&state?.phase==='round_end')b.disabled=false;
 }catch(e){b.disabled=false;toast(e.message);renderRoundTransition()}
}
function syncTimerAnchor(s){
 if(!s||!['investigate','thinking','final_thinking'].includes(s.phase)||!Number.isFinite(Number(s.remainingMs))){timerAnchor=null;return}
 timerAnchor={phase:s.phase,round:s.round,session:s.gameSessionId,remainingMs:Math.max(0,Number(s.remainingMs)),at:performance.now()}
}
function startTimer(){clearInterval(localTimer);const tick=()=>{
 if(!state){$('#timer').textContent='--:--';return}
 if(state.phase==='round_end'){$('#timer').textContent='確認待ち';return}
 if(state.phase==='investigate_ready'){$('#timer').textContent='開始待ち';return}
 if(state.phase==='final_thinking_ready'){$('#timer').textContent='開始待ち';return}
 if(state.phase==='answer_reveal_ready'){$('#timer').textContent='確認待ち';return}
 if(state.phase==='answer_reveal'){$('#timer').textContent='--:--';return}
 if(!['investigate','thinking','final_thinking'].includes(state.phase)){$('#timer').textContent='--:--';return}
 if(!timerAnchor||timerAnchor.phase!==state.phase||timerAnchor.round!==state.round||timerAnchor.session!==state.gameSessionId){
   const fallback=state.phase==='investigate'?Number(state.settings?.investigateSec||0):(state.phase==='final_thinking'?Number(state.settings?.finalThinkingSec||0):Number(state.settings?.thinkingSec||0));
   timerAnchor={phase:state.phase,round:state.round,session:state.gameSessionId,remainingMs:Math.max(0,fallback*1000),at:performance.now()}
 }
 const ms=Math.max(0,timerAnchor.remainingMs-(performance.now()-timerAnchor.at)),sec=Math.ceil(ms/1000);
 $('#timer').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`
};tick();localTimer=setInterval(tick,200)}
function openMove(){if(state.moveLocked)return;action('beginMove',{}).then(r=>{if(r?.ok)showMoveModal(r.available)})}
function showMoveModal(av){$('#modalBody').innerHTML='<h3>移動先を選択</h3><div class="machine-select">'+['A','B','C','D','E','F'].map(m=>`<button class="machine-btn" data-m="${m}" ${av.includes(m)?'':'disabled'}>${m}${av.includes(m)?'':'<br>使用中'}</button>`).join('')+'</div>';$('#modal').classList.remove('hidden');$('#modalBody').querySelectorAll('[data-m]:not(:disabled)').forEach(b=>b.onclick=async()=>{await action('finishMove',{machine:b.dataset.m});closeModal()})}
function closeModal(){if(state?.moveLocked&&state.moveLockId===me?.id)action('cancelMove',{});$('#modal').classList.add('hidden')}
function openMemo(){ensureNotes();const sh=notebooks[currentNoteMachine];$('#modalBody').innerHTML=`<h3>${currentNoteMachine}台 非公開メモ</h3><textarea id="memoText">${esc(sh.memo||'')}</textarea><button id="saveMemo" class="primary">保存</button>`;$('#modal').classList.remove('hidden');$('#saveMemo').onclick=()=>{sh.memo=$('#memoText').value;saveNotes();$('#modal').classList.add('hidden')}}
async function leave(){if(roomId&&token)try{await api(`/api/room/${roomId}/leave`,{method:'POST',body:JSON.stringify({token})})}catch{}leaveLocal();loadRooms()}
function leaveLocal(){localStorage.removeItem(ACTIVE_ROOM_KEY);localStorage.removeItem(ACTIVE_NAME_KEY);roomId=null;token=null;state=null;me=null;lobbySettingsDraft=null;lobbySettingsDirty=false;lobbySettingsRoom=null;drawDisplaySession=null;notebooks={};notebookSessionId=null;lastMeMachine=null;currentNoteMachine='A';mobileSheetView='record';clearDrawDisplay();if(ws)try{ws.close()}catch{};ws=null;$('#leaveBtn').classList.add('hidden');setView('titleView');$('#phaseMini').textContent=''}
['#investigateSec','#thinkingSec','#finalThinkingSec','#roundCount','#gameMode','#autoRecordToggle'].forEach(id=>$(id).addEventListener('input',markLobbySettingsDirty));
$('#startBtn').onclick=()=>{const cfg=readLobbySettingsDraft();lobbySettingsDraft=cfg;return action('start',cfg)};
$('#forceEndBtn').onclick=()=>confirm('ゲームを強制終了しますか？')&&action('forceEnd',{});
$('#resetBtn').onclick=()=>confirm('ROOMを完全に初期化しますか？')&&action('reset',{});
$('#leaveBtn').onclick=leave;
$('#moveBtn').onclick=openMove;
$('#memoBtn').onclick=openMemo;
$('#earlyFinalBtn').onclick=goEarlyFinalThinking;$('#earlyFinalTopBtn').onclick=goEarlyFinalThinking;
$('#modalClose').onclick=closeModal;$('#roundEndOk').onclick=acknowledgeRoundEnd;$('#investigateStartBtn').onclick=startInvestigation;$('#finalThinkingStartBtn').onclick=startFinalThinking;$('#answerRevealStartBtn').onclick=startAnswerReveal;
$('#deleteModeBtn').onclick=()=>{deleteMode=!deleteMode;renderNotebook()};
$('#recordTabBtn').onclick=()=>setSheetView('record');
$('#referenceTabBtn').onclick=()=>setSheetView('reference');
$('#yellowBtn').onclick=()=>{if(me.yellow>0){yellowArmed=!yellowArmed;renderDrawControls()}};
$('#drawBtn').onclick=async()=>{if(revealBusy)return;revealBusy=true;renderDrawControls();try{await action('draw',{useYellow:yellowArmed})}finally{setTimeout(()=>{if(revealBusy){revealBusy=false;renderDrawControls()}},5000)}};
$('#nameInput').value=loadName();$('#nameInput').addEventListener('input',e=>sessionStorage.setItem(NAME_DRAFT_KEY,e.target.value));$('#refreshRoomsBtn').onclick=loadRooms;document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&roomId&&(!ws||ws.readyState!==WebSocket.OPEN))scheduleReconnect()});window.addEventListener('online',scheduleReconnect);async function boot(){await loadRooms();const ar=localStorage.getItem(ACTIVE_ROOM_KEY),an=localStorage.getItem(ACTIVE_NAME_KEY);if(ar&&ROOM_IDS.includes(ar)&&an&&localStorage.getItem(sessionKey(ar))){$('#nameInput').value=an;await joinRoom(ar,an)}}boot();

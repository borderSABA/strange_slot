'use strict';
const VERSION='0.1.0';
// デプロイ後のWorker URLに変更してください。
const SERVER_URL='https://strange-slot-online.naitoryo7110.workers.dev';
const COMMON_NAME_KEY='boardgame_player_name';
const GAME_ID='strange_slot_simulator';
const GAME_NAME='ストレンジスロットシミュレーター';
const SYMBOLS=[
 {id:'bell',name:'ベル',icon:'🔔'},
 {id:'grape',name:'ブドウ',icon:'🍇'},
 {id:'cherry',name:'チェリー',icon:'🍒'},
 {id:'bellCherry',name:'ベル＋チェリー',icon:'🔔🍒'},
 {id:'watermelon',name:'スイカ',icon:'🍉'},
 {id:'bellWatermelon',name:'ベル＋スイカ',icon:'🔔🍉'},
 {id:'sun',name:'太陽',icon:'☀️'},
 {id:'moon',name:'月',icon:'🌙'}
];
let roomId=null, token=null, state=null, ws=null, me=null;
let yellowArmed=false, deleteMode=false, revealBusy=false, localTimer=null;
let notebooks={}, currentNoteMachine='A';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function toast(t){const e=$('#toast');e.textContent=t;e.classList.remove('hidden');setTimeout(()=>e.classList.add('hidden'),2200)}
function pop(t){const e=$('#bigPop');e.textContent=t;e.classList.remove('hidden');setTimeout(()=>e.classList.add('hidden'),1800)}
function setView(id){$$('.view').forEach(v=>v.classList.remove('active'));$('#'+id).classList.add('active')}
function getName(){return $('#nameInput').value.trim()}
function saveName(n){localStorage.setItem(COMMON_NAME_KEY,n);localStorage.setItem('playerName',n);localStorage.setItem('boardgamePlayerName',n)}
function loadName(){return localStorage.getItem(COMMON_NAME_KEY)||localStorage.getItem('boardgamePlayerName')||localStorage.getItem('playerName')||''}
function sessionKey(r){return `sss_token_room_${r}`}
function noteKey(r,n){return `sss_notes_${r}_${n}`}
function saveNotes(){if(roomId&&me)localStorage.setItem(noteKey(roomId,me.name),JSON.stringify(notebooks))}
function loadNotes(){try{return JSON.parse(localStorage.getItem(noteKey(roomId,me?.name))||'{}')}catch{return {}}}
function blankSheet(){return {pred:[],spins:[],memo:''}}
function ensureNotes(){for(const m of ['A','B','C','D','E','F']) if(!notebooks[m])notebooks[m]=blankSheet()}
async function api(path,opts={}){const r=await fetch(SERVER_URL+path,{...opts,headers:{'content-type':'application/json',...(opts.headers||{})}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);return j}
async function loadRooms(){try{const d=await api('/api/rooms');renderRooms(d.rooms||[])}catch(e){renderRooms([]);toast('サーバーへ接続できません') }}
function renderRooms(rooms){const box=$('#rooms');box.innerHTML='';for(let i=1;i<=4;i++){const r=rooms.find(x=>x.id===String(i))||{id:String(i),players:[],phase:'empty'};const div=document.createElement('div');div.className='room';div.innerHTML=`<h3>ROOM ${i}</h3><div class="names">${r.players.length?esc(r.players.join(' / ')):'空室'}</div><div class="state">${phaseLabel(r.phase)}</div><div>${r.players.length}人</div><button data-room="${i}">${r.players.length?'参加':'新規作成'}</button>`;box.appendChild(div)}box.querySelectorAll('button').forEach(b=>b.onclick=()=>joinRoom(b.dataset.room))}
function phaseLabel(p){return ({empty:'空室',lobby:'待機中',ticket:'抽選券選択',machine_select:'台選択',investigate:'調査中',thinking:'シンキング',final_answer:'最終回答',result:'結果'})[p]||p}
async function joinRoom(r){const name=getName();if(!name)return toast('名前を入力してください');saveName(name);try{let old=localStorage.getItem(sessionKey(r));const d=await api(`/api/room/${r}/join`,{method:'POST',body:JSON.stringify({name,token:old})});roomId=r;token=d.token;localStorage.setItem(sessionKey(r),token);await fetchState();connectWs();$('#leaveBtn').classList.remove('hidden')}catch(e){toast(e.message)}}
async function fetchState(){if(!roomId||!token)return;state=await api(`/api/room/${roomId}/state?token=${encodeURIComponent(token)}`);onState(state)}
function connectWs(){if(ws)try{ws.close()}catch{};const u=SERVER_URL.replace(/^http/,'ws')+`/api/room/${roomId}/ws?token=${encodeURIComponent(token)}`;ws=new WebSocket(u);ws.onmessage=ev=>{try{const m=JSON.parse(ev.data);if(m.type==='state')onState(m.state);if(m.type==='draw')onDraw(m)}catch{}};ws.onclose=()=>{if(roomId)setTimeout(connectWs,1300)}}
function onState(s){state=s;me=s.me;$('#phaseMini').textContent=`R${s.round||'-'} ${phaseLabel(s.phase)}`;if(s.phase==='lobby'){setView('lobbyView');renderLobby()}else if(s.phase==='empty'){leaveLocal();return}else{setView('gameView');if(!Object.keys(notebooks).length){notebooks=loadNotes();ensureNotes()}renderGame()}startTimer()}
function renderLobby(){$('#roomNo').textContent=roomId;$('#lobbyPlayers').innerHTML=state.players.map(p=>`<div class="player-card ${p.id===me.id?'me':''}"><b>${esc(p.name)}</b><span>${p.isHost?'HOST':''}</span></div>`).join('');const host=me.isHost;$('#hostSettings').classList.toggle('hidden',!host);$('#investigateSec').value=state.settings.investigateSec;$('#thinkingSec').value=state.settings.thinkingSec;$('#finalThinkingSec').value=state.settings.finalThinkingSec;$('#autoRecordToggle').checked=localStorage.getItem('sss_auto_record')==='1'}
function renderGame(){renderPlayers();$('#roundInfo').innerHTML=`<b>ラウンド ${state.round}/4</b><br>${phaseLabel(state.phase)}${state.selectTurnName?`<br>選択：${esc(state.selectTurnName)}`:''}`;$('#machineBox').innerHTML=`現在台：<b>${me.machine||'なし'}</b>${me.ticket!=null?`<br>抽選券：${me.ticket}`:''}`;$('#moveBtn').disabled=state.phase!=='investigate'||!me.machine||state.moveLocked;$('#moveBtn').textContent=state.moveLocked?`${state.moveLockName||'誰か'}が台移動中`:'台移動';renderTicket();renderMachineSelect();renderDrawControls();renderNotebook();renderFinalAnswer();renderResult()}
function renderPlayers(){const h=state.players.map(p=>`<div class="player-card ${p.id===me.id?'me':''} ${p.red?'red':''}"><b>${esc(p.name)}</b><span>🔔${p.publicBell}　🟡${p.publicYellow}${p.red?'　🔴':''}</span></div>`).join('');$('#playersGame').innerHTML=h}
function renderTicket(){const a=$('#ticketArea');a.classList.toggle('hidden',state.phase!=='ticket');if(state.phase!=='ticket')return;if(me.ticketChosen){a.innerHTML='<div style="grid-column:1/-1;text-align:center">全員の選択を待っています…</div>';return}a.innerHTML=state.ticketSlots.map((_,i)=>`<button class="ticket" data-i="${i}">?</button>`).join('');a.querySelectorAll('button').forEach(b=>b.onclick=()=>action('pickTicket',{slot:+b.dataset.i}))}
function renderMachineSelect(){const a=$('#machineSelectArea');const on=state.phase==='machine_select';a.classList.toggle('hidden',!on);if(!on)return;const mine=state.selectTurnId===me.id;const occ=new Map(state.players.filter(p=>p.machine).map(p=>[p.machine,p.name]));a.innerHTML=`<div style="grid-column:1/-1;text-align:center">${mine?'台を選んでください':`${esc(state.selectTurnName||'')} の選択待ち`}</div>`+['A','B','C','D','E','F'].map(m=>`<button class="machine-btn ${occ.has(m)?'occupied':''}" data-m="${m}" ${!mine||occ.has(m)?'disabled':''}>${m}${occ.has(m)?`<br>${esc(occ.get(m))}使用中`:''}</button>`).join('');a.querySelectorAll('[data-m]').forEach(b=>b.onclick=()=>action('selectMachine',{machine:b.dataset.m}))}
function renderDrawControls(){const show=['investigate','thinking'].includes(state.phase);$('#drawArea').classList.toggle('hidden',!show);$('#drawBtn').disabled=state.phase!=='investigate'||!me.machine||revealBusy;$('#yellowBtn').disabled=state.phase!=='investigate'||me.yellow<=0||revealBusy;$('#yellowBtn').textContent=`目押し ×${me.yellow}`;$('#yellowBtn').classList.toggle('active',yellowArmed);$('#bonusInfo').innerHTML=`ボーナスカウント 🔔 <b>${me.bell}</b>　<span class="yellow-chip">🟡 ${me.yellow}</span>　${me.red?'<span class="red-chip">🔴 上位突入 / 4枚抽選</span>':'通常3枚抽選'}`;if(me.lastDraw?.length&&!revealBusy)showCards(me.lastDraw,false)}
function symbolDef(id){return SYMBOLS.find(x=>x.id===id)||{name:id,icon:'?'}}
function showCards(ids,clear=true){const box=$('#drawCards');if(clear)box.innerHTML='';for(const id of ids){const s=symbolDef(id);const d=document.createElement('div');d.className='slot-card';d.innerHTML=`<div class="icon">${s.icon}</div><div>${s.name}</div>`;box.appendChild(d)}}
async function onDraw(m){if(m.playerId!==me.id)return;revealBusy=true;$('#drawBtn').disabled=true;const box=$('#drawCards');box.innerHTML='';for(const id of m.cards){await new Promise(r=>setTimeout(r,1000));showCards([id],false)}if(m.crossedRed)pop('上位突入！');if(m.autoEligible&&autoRecord()){recordSpin(m.machine,m.cards)}else{recordSpin(m.machine,[])}yellowArmed=false;revealBusy=false;renderDrawControls();saveNotes()}
function autoRecord(){return localStorage.getItem('sss_auto_record')==='1'}
function recordSpin(machine,cards){ensureNotes();const counts={};for(const s of SYMBOLS)counts[s.id]=0;for(const c of cards)counts[c]=(counts[c]||0)+1;notebooks[machine].spins.push(counts);currentNoteMachine=machine;$('#noteMachineSelect').value=machine;saveNotes();renderNotebook()}
function renderNotebook(){if(!me)return;ensureNotes();const sel=$('#noteMachineSelect');if(!sel.options.length){sel.innerHTML=['A','B','C','D','E','F'].map(m=>`<option>${m}</option>`).join('');sel.onchange=()=>{currentNoteMachine=sel.value;renderNotebook()}}sel.value=currentNoteMachine;const sh=notebooks[currentNoteMachine];$('#predictionRow').innerHTML='<b>予測設定</b>'+[1,2,3,4,5,6].map(n=>`<button class="pred ${sh.pred.includes(n)?'on':''}" data-p="${n}">${n}</button>`).join('');$('#predictionRow').querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{const n=+b.dataset.p;sh.pred=sh.pred.includes(n)?sh.pred.filter(x=>x!==n):[...sh.pred,n];saveNotes();renderNotebook()});const cols=Math.max(12,sh.spins.length);let html=`<div class="note-grid" style="--cols:${cols}"><div class="note-head">シンボル</div><div class="note-head">累計</div>`;for(let c=0;c<cols;c++)html+=`<div class="note-head">${c+1}</div>`;for(const sym of SYMBOLS){const total=sh.spins.reduce((a,x)=>a+(x[sym.id]||0),0);html+=`<div class="note-cell note-symbol">${sym.icon} ${sym.name}</div><div class="note-cell note-total">${total}</div>`;for(let c=0;c<cols;c++){const val=sh.spins[c]?.[sym.id]||0;html+=`<div class="note-cell note-square ${deleteMode?'delete-target':''}" data-s="${sym.id}" data-c="${c}"><span>${val||''}</span></div>`}}html+='</div>';$('#notebook').innerHTML=html;$('#notebook').querySelectorAll('.note-square').forEach(cell=>cell.onclick=()=>editNoteCell(cell));$('#deleteModeBtn').classList.toggle('delete-on',deleteMode)}
function editNoteCell(cell){const sh=notebooks[currentNoteMachine], c=+cell.dataset.c,s=cell.dataset.s;while(sh.spins.length<=c){const o={};SYMBOLS.forEach(x=>o[x.id]=0);sh.spins.push(o)}if(deleteMode){sh.spins[c][s]=0;deleteMode=false}else{sh.spins[c][s]=(sh.spins[c][s]||0)+1}saveNotes();renderNotebook()}
function renderFinalAnswer(){const a=$('#finalAnswerArea');a.classList.toggle('hidden',state.phase!=='final_answer');if(state.phase!=='final_answer')return;const ans=me.finalAnswer||{};a.innerHTML='<h2>最終回答</h2><p>設定1～6を1回ずつ使ってください。同じ数字がある場合は赤表示します。</p>'+['A','B','C','D','E','F'].map(m=>`<div class="answer-row" data-r="${m}"><b>${m}台</b><select data-m="${m}"><option value="">--</option>${[1,2,3,4,5,6].map(n=>`<option value="${n}" ${ans[m]===n?'selected':''}>設定${n}</option>`).join('')}</select></div>`).join('')+'<button id="submitAnswer" class="primary wide">最終回答を確定</button>';a.querySelectorAll('select').forEach(s=>s.onchange=checkDupAnswers);$('#submitAnswer').onclick=submitFinal;checkDupAnswers()}
function checkDupAnswers(){const vals=[...$('#finalAnswerArea').querySelectorAll('select')].map(s=>s.value).filter(Boolean);const dup=new Set(vals.filter((v,i,a)=>a.indexOf(v)!==i));$('#finalAnswerArea').querySelectorAll('.answer-row').forEach(r=>r.classList.toggle('dup',dup.has(r.querySelector('select').value)));return dup.size===0&&vals.length===6}
async function submitFinal(){if(!checkDupAnswers())return toast('設定1～6を1回ずつ選んでください');const answer={};$('#finalAnswerArea').querySelectorAll('select').forEach(s=>answer[s.dataset.m]=+s.value);await action('finalAnswer',{answer})}
function renderResult(){const a=$('#resultArea');a.classList.toggle('hidden',state.phase!=='result');if(state.phase!=='result')return;const mine=state.results?.find(x=>x.id===me.id);a.innerHTML=`<h2>RESULT</h2><h1>${mine?.score??0} / 6 点</h1><table><tr><th>台</th><th>正解</th><th>回答</th></tr>${['A','B','C','D','E','F'].map(m=>`<tr class="${mine?.answer?.[m]===state.solution?.[m]?'correct':'wrong'}"><td>${m}</td><td>設定${state.solution?.[m]}</td><td>${mine?.answer?.[m]?`設定${mine.answer[m]}`:'-'}</td></tr>`).join('')}</table><h3>${(state.winners||[]).map(esc).join(' / ')} 勝利</h3>${me.isHost?'<button id="backLobby" class="primary">ロビーへ戻る</button>':''}`;$('#backLobby')?.addEventListener('click',()=>action('backLobby',{}))}
async function action(type,payload={}){try{return await api(`/api/room/${roomId}/action`,{method:'POST',body:JSON.stringify({token,type,...payload})})}catch(e){toast(e.message)}}
function startTimer(){clearInterval(localTimer);const tick=()=>{if(!state?.deadline){$('#timer').textContent='--:--';return}const ms=Math.max(0,state.deadline-Date.now()),sec=Math.ceil(ms/1000);$('#timer').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`};tick();localTimer=setInterval(tick,250)}
function openMove(){if(state.moveLocked)return;action('beginMove',{}).then(r=>{if(r?.ok)showMoveModal(r.available)})}
function showMoveModal(av){$('#modalBody').innerHTML='<h3>移動先を選択</h3><div class="machine-select">'+['A','B','C','D','E','F'].map(m=>`<button class="machine-btn" data-m="${m}" ${av.includes(m)?'':'disabled'}>${m}${av.includes(m)?'':'<br>使用中'}</button>`).join('')+'</div>';$('#modal').classList.remove('hidden');$('#modalBody').querySelectorAll('[data-m]:not(:disabled)').forEach(b=>b.onclick=async()=>{await action('finishMove',{machine:b.dataset.m});closeModal()})}
function closeModal(){if(state?.moveLocked&&state.moveLockId===me?.id)action('cancelMove',{});$('#modal').classList.add('hidden')}
function openMemo(){ensureNotes();const sh=notebooks[currentNoteMachine];$('#modalBody').innerHTML=`<h3>${currentNoteMachine}台 非公開メモ</h3><textarea id="memoText">${esc(sh.memo||'')}</textarea><button id="saveMemo" class="primary">保存</button>`;$('#modal').classList.remove('hidden');$('#saveMemo').onclick=()=>{sh.memo=$('#memoText').value;saveNotes();$('#modal').classList.add('hidden')}}
async function leave(){if(roomId&&token)try{await api(`/api/room/${roomId}/leave`,{method:'POST',body:JSON.stringify({token})})}catch{}leaveLocal();loadRooms()}
function leaveLocal(){roomId=null;token=null;state=null;me=null;if(ws)try{ws.close()}catch{};ws=null;$('#leaveBtn').classList.add('hidden');setView('titleView');$('#phaseMini').textContent=''}
$('#saveSettingsBtn').onclick=()=>action('settings',{investigateSec:+$('#investigateSec').value,thinkingSec:+$('#thinkingSec').value,finalThinkingSec:+$('#finalThinkingSec').value});
$('#startBtn').onclick=()=>action('start',{});
$('#forceEndBtn').onclick=()=>confirm('ゲームを強制終了しますか？')&&action('forceEnd',{});
$('#resetBtn').onclick=()=>confirm('ROOMを完全に初期化しますか？')&&action('reset',{});
$('#leaveBtn').onclick=leave;
$('#moveBtn').onclick=openMove;
$('#memoBtn').onclick=openMemo;
$('#modalClose').onclick=closeModal;
$('#deleteModeBtn').onclick=()=>{deleteMode=!deleteMode;renderNotebook()};
$('#autoRecordToggle').onchange=e=>localStorage.setItem('sss_auto_record',e.target.checked?'1':'0');
$('#yellowBtn').onclick=()=>{if(me.yellow>0){yellowArmed=!yellowArmed;renderDrawControls()}};
$('#drawBtn').onclick=async()=>{if(revealBusy)return;revealBusy=true;renderDrawControls();try{await action('draw',{useYellow:yellowArmed})}finally{setTimeout(()=>{if(revealBusy){revealBusy=false;renderDrawControls()}},9000)}};
$('#nameInput').value=loadName();loadRooms();

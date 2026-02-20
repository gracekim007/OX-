/* 오답 변형 OX 문법 (Hash Router + LocalStorage)
   - 학습: 전체 / 오답만 / 북마크만
   - 오답이면 "AI 변형" 버튼으로 그때그때 N개 생성해서 바로 풀기 (기본: 3개)
   - AI 호출은 /api/variants (Vercel Function)로 우회 (API 키 유출 방지)
*/

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const LS_KEY = "ox_wrong_variant_data_v1";
const SETTINGS_KEY = "ox_wrong_variant_settings_v1";

const DEFAULT_SETTINGS = {
  aiCount: 3,
  aiStoreVariants: false, // 기본: 그때그때(임시)
  aiLanguage: "ko",       // 해설 언어(ko/en)
};

const nowISO = () => new Date().toISOString();
const uid = (prefix="id") => `${prefix}_${Math.random().toString(36).slice(2,9)}_${Date.now().toString(36)}`;

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function toast(msg, ms=1600){
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>{ el.hidden = true; }, ms);
}

function openModal(title, bodyHTML, footerHTML){
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = bodyHTML;
  $("#modal-footer").innerHTML = footerHTML || "";
  $("#modal").hidden = false;
  // close handlers
  $$("#modal [data-close]").forEach(b=>{
    b.onclick = () => closeModal();
  });
}
function closeModal(){ $("#modal").hidden = true; }

function loadSettings(){
  try{
    const raw = localStorage.getItem(SETTINGS_KEY);
    if(!raw) return {...DEFAULT_SETTINGS};
    const s = JSON.parse(raw);
    return {...DEFAULT_SETTINGS, ...(s||{})};
  }catch(e){
    return {...DEFAULT_SETTINGS};
  }
}
function saveSettings(s){
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function loadData(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return initData();
    const data = JSON.parse(raw);
    if(!data || typeof data !== "object") return initData();
    if(!data.version) data.version = 1;
    if(!data.decks) data.decks = [];
    if(!data.cards) data.cards = {};
    if(!data.stats) data.stats = {};
    if(!data.bookmarks) data.bookmarks = {}; // {cardId:true}
    return data;
  }catch(e){
    return initData();
  }
}
function saveData(){
  localStorage.setItem(LS_KEY, JSON.stringify(DATA));
}

function initData(){
  const deckId = uid("deck");
  const exampleCards = [
    {
      id: uid("card"),
      deckId,
      prompt: "The man whom I think is honest is my teacher.",
      answer: "X",
      explanation: "I think (that) he is honest 구조 → he가 주어이므로 who가 맞습니다.",
      tags: ["who/whom"]
    },
    {
      id: uid("card"),
      deckId,
      prompt: "The man whom I met yesterday is my teacher.",
      answer: "O",
      explanation: "I met him 구조 → him은 목적어라 whom이 가능합니다.",
      tags: ["who/whom"]
    },
    {
      id: uid("card"),
      deckId,
      prompt: "Only after he left did she realize the truth.",
      answer: "O",
      explanation: "Only + 부사구 문두 → 조동사 도치(did she realize)가 필요합니다.",
      tags: ["inversion"]
    }
  ];
  const cards = {};
  exampleCards.forEach(c=> cards[c.id] = {...c, createdAt: nowISO()});
  const deck = { id: deckId, name: "샘플(삭제가능)", createdAt: nowISO(), cardIds: exampleCards.map(c=>c.id) };
  return {
    version: 1,
    decks: [deck],
    cards,
    stats: {},
    bookmarks: {},
  };
}

let DATA = loadData();
let SETTINGS = loadSettings();

const STATE = {
  study: null,     // {deckId, mode, queue, index, answered, choice}
  variant: null,   // {source:{...}, queue, index, answered, choice, fromStudy:true}
};

// Register SW (optional)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  });
}

function setSubtitle(text){ $("#subtitle").textContent = text; }

function deckById(deckId){ return DATA.decks.find(d=>d.id===deckId) || null; }
function cardById(cardId){ return DATA.cards[cardId] || null; }

function deckCounts(deckId){
  const deck = deckById(deckId);
  if(!deck) return {total:0, wrong:0, correct:0, bookmarked:0};
  let total = deck.cardIds.length;
  let wrong = 0, correct = 0, bookmarked = 0;
  for(const cid of deck.cardIds){
    const st = DATA.stats[cid];
    if(st?.wrong) wrong += st.wrong;
    if(st?.correct) correct += st.correct;
    if(DATA.bookmarks?.[cid]) bookmarked += 1;
  }
  return {total, wrong, correct, bookmarked};
}

function ensureDeck(name="새 카테고리"){
  const id = uid("deck");
  const deck = { id, name, createdAt: nowISO(), cardIds: [] };
  DATA.decks.unshift(deck);
  saveData();
  return deck;
}

function normalizeAnswer(a){
  const v = (a||"").trim().toUpperCase();
  if(v==="O"||v==="X") return v;
  if(v==="0") return "O";
  return null;
}

function parseCardsJSON(raw){
  // Accept array or object with "cards" array
  const j = JSON.parse(raw);
  const arr = Array.isArray(j) ? j : (Array.isArray(j.cards) ? j.cards : null);
  if(!arr) throw new Error("JSON은 배열([{prompt,answer,explanation}]) 또는 {cards:[...]} 형식이어야 합니다.");
  const cards = [];
  for(const it of arr){
    if(!it) continue;
    const prompt = (it.prompt ?? it.q ?? it.question ?? "").toString().trim();
    const answer = normalizeAnswer(it.answer ?? it.a ?? it.ans ?? it.correct ?? "");
    const explanation = (it.explanation ?? it.exp ?? it.commentary ?? it.reason ?? "").toString().trim();
    const tagsRaw = it.tags ?? it.tag ?? [];
    const tags = Array.isArray(tagsRaw) ? tagsRaw.map(x=>String(x).trim()).filter(Boolean) :
                 String(tagsRaw||"").split(",").map(x=>x.trim()).filter(Boolean);
    if(!prompt || !answer) continue;
    cards.push({ prompt, answer, explanation, tags });
  }
  if(!cards.length) throw new Error("가져올 카드가 없습니다. (prompt/answer 필수)");
  return cards;
}

function createCard(deckId, {prompt, answer, explanation="", tags=[]}){
  const id = uid("card");
  DATA.cards[id] = {
    id, deckId,
    prompt: String(prompt||"").trim(),
    answer: normalizeAnswer(answer) || "O",
    explanation: String(explanation||"").trim(),
    tags: Array.isArray(tags) ? tags : [],
    createdAt: nowISO()
  };
  const deck = deckById(deckId);
  if(deck) deck.cardIds.unshift(id);
  saveData();
  return id;
}

function updateCard(cardId, patch){
  const c = cardById(cardId);
  if(!c) return;
  Object.assign(c, patch);
  saveData();
}

function deleteCard(cardId){
  const c = cardById(cardId);
  if(!c) return;
  const deck = deckById(c.deckId);
  if(deck) deck.cardIds = deck.cardIds.filter(id=>id!==cardId);
  delete DATA.cards[cardId];
  delete DATA.stats[cardId];
  if(DATA.bookmarks) delete DATA.bookmarks[cardId];
  saveData();
}

function toggleBookmark(cardId){
  if(!DATA.bookmarks) DATA.bookmarks = {};
  DATA.bookmarks[cardId] = !DATA.bookmarks[cardId];
  if(!DATA.bookmarks[cardId]) delete DATA.bookmarks[cardId];
  saveData();
}

function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
  return arr;
}

function startStudy(deckId, mode="all"){
  const deck = deckById(deckId);
  if(!deck) return;
  let queue = [...deck.cardIds];
  if(mode==="wrong"){
    queue = queue.filter(cid => (DATA.stats[cid]?.wrong||0) > 0);
  }else if(mode==="bookmark"){
    queue = queue.filter(cid => !!DATA.bookmarks?.[cid]);
  }
  if(!queue.length){
    toast(mode==="wrong" ? "오답이 없습니다." : mode==="bookmark" ? "북마크가 없습니다." : "카드가 없습니다.");
    return;
  }
  shuffle(queue);
  STATE.study = { deckId, mode, queue, index: 0, answered: false, choice: null, lastCorrect: null };
  location.hash = `#/study/${deckId}?mode=${mode}`;
}

function getQueryParams(hash){
  const i = hash.indexOf("?");
  if(i<0) return {};
  const q = hash.slice(i+1);
  const params = {};
  for(const part of q.split("&")){
    const [k,v] = part.split("=");
    if(!k) continue;
    params[decodeURIComponent(k)] = decodeURIComponent(v||"");
  }
  return params;
}

function route(){
  const hash = location.hash || "#/";
  const app = $("#app");

  // Back button state
  const backBtn = $("#nav-back");
  backBtn.hidden = (hash === "#/" || hash === "");
  backBtn.onclick = () => history.back();

  if(hash.startsWith("#/study/")){
    const deckId = hash.split("#/study/")[1].split("?")[0];
    const params = getQueryParams(hash);
    const mode = params.mode || "all";
    renderStudy(deckId, mode);
    return;
  }
  if(hash.startsWith("#/variant")){
    renderVariant();
    return;
  }
  if(hash.startsWith("#/deck/")){
    const deckId = hash.split("#/deck/")[1].split("?")[0];
    renderDeckManage(deckId);
    return;
  }
  renderHome();
}

window.addEventListener("hashchange", route);
window.addEventListener("load", route);

// Settings button
$("#nav-settings").onclick = () => {
  const s = loadSettings();
  const body = `
    <div class="card" style="box-shadow:none;border:0;background:transparent;padding:0">
      <div class="h1">설정</div>
      <div class="small">AI 변형은 <b>오답을 선택했을 때</b>만 버튼이 나타납니다.</div>
      <hr class="sep" />
      <div class="row" style="align-items:flex-end">
        <div class="grow">
          <label>AI 변형 문제 개수 (1~8)</label>
          <input id="set-aiCount" class="input" type="number" min="1" max="8" value="${s.aiCount}" />
        </div>
        <button id="set-save" class="btn ${s.aiStoreVariants?'primary':'ghost'}" style="min-width:140px">
          ${s.aiStoreVariants ? "변형 저장: ON" : "변형 저장: OFF"}
        </button>
      </div>
      <div class="small" style="margin-top:8px">
        • 저장 OFF: 생성한 변형문제는 <b>그때그때만</b> 풀고 사라집니다.<br/>
        • 저장 ON: 변형문제를 <b>“AI 변형”</b> 카테고리에 저장해둘 수 있습니다.
      </div>
      <hr class="sep" />
      <div class="row end">
        <button id="set-reset" class="btn bad">전체 초기화(주의)</button>
      </div>
    </div>
  `;
  const footer = `<button class="btn primary" data-close="1">닫기</button>`;
  openModal("설정", body, footer);

  $("#set-save").onclick = () => {
    const cur = loadSettings();
    cur.aiStoreVariants = !cur.aiStoreVariants;
    saveSettings(cur);
    SETTINGS = cur;
    closeModal();
    toast("저장되었습니다");
  };

  $("#set-aiCount").onchange = (e) => {
    const cur = loadSettings();
    cur.aiCount = clamp(parseInt(e.target.value||"3",10)||3, 1, 8);
    saveSettings(cur);
    SETTINGS = cur;
  };

  $("#set-reset").onclick = () => {
    openModal(
      "전체 초기화",
      `<div class="p">모든 카테고리/카드/통계/북마크를 삭제하고 초기상태로 되돌립니다. 정말 할까요?</div>`,
      `<button class="btn ghost" data-close="1">취소</button>
       <button id="confirm-reset" class="btn bad">초기화</button>`
    );
    $("#confirm-reset").onclick = () => {
      DATA = initData();
      saveData();
      closeModal();
      toast("초기화 완료");
      location.hash = "#/";
    };
  };
};

function renderHome(){
  setSubtitle("틀린 문제를 바로 변형해서 추가 훈련");
  const app = $("#app");

  const deckCards = DATA.decks.map(deck=>{
    const c = deckCounts(deck.id);
    return `
      <div class="card">
        <div class="row space">
          <div class="grow">
            <div class="h1">${escapeHtml(deck.name)}</div>
            <div class="kpi">
              <span>총 <b>${c.total}</b></span>
              <span class="badge bad">오답 <b>${c.wrong}</b></span>
              <span class="badge star">★ <b>${c.bookmarked}</b></span>
            </div>
          </div>
          <button class="btn ghost" data-open-deck="${deck.id}">관리</button>
        </div>
        <hr class="sep" />
        <div class="row">
          <button class="btn primary" data-study="${deck.id}" data-mode="all">학습</button>
          <button class="btn bad" data-study="${deck.id}" data-mode="wrong" ${c.wrong>0?'':'disabled'}>오답만</button>
          <button class="btn" data-study="${deck.id}" data-mode="bookmark" ${c.bookmarked>0?'':'disabled'}>북마크</button>
        </div>
      </div>
    `;
  }).join("");

  app.innerHTML = `
    <div class="card">
      <div class="row space">
        <div>
          <div class="h1">카테고리</div>
          <div class="p">문제 추가/가져오기 후, <b>오답만</b> 모드에서 틀린 문제를 돌리면서 필요할 때만 <b>AI 변형</b>을 생성하세요.</div>
        </div>
        <button id="btn-newDeck" class="btn">+ 카테고리</button>
      </div>
    </div>
    ${deckCards || `<div class="card"><div class="p">카테고리가 없습니다.</div></div>`}
    <div class="card">
      <div class="h2">데이터 백업</div>
      <div class="row">
        <button id="btn-exportAll" class="btn">전체 내보내기(JSON)</button>
        <button id="btn-importAll" class="btn">전체 가져오기(JSON)</button>
      </div>
      <div class="small" style="margin-top:10px">
        • “전체 가져오기”는 기존 데이터를 <b>덮어쓰지 않고</b> 합칩니다(카드는 새 ID로 재생성).<br/>
        • 기존 앱에서 내보낸 배열([{prompt,answer,explanation}])도 그대로 가져올 수 있습니다.
      </div>
    </div>
  `;

  $("#btn-newDeck").onclick = () => {
    openModal(
      "카테고리 만들기",
      `<label>카테고리 이름</label><input id="newDeckName" class="input" placeholder="예: 관계사 / 가정법" />`,
      `<button class="btn ghost" data-close="1">취소</button>
       <button id="createDeck" class="btn primary">생성</button>`
    );
    $("#createDeck").onclick = () => {
      const name = ($("#newDeckName").value || "").trim() || "새 카테고리";
      const deck = ensureDeck(name);
      closeModal();
      toast("생성 완료");
      location.hash = `#/deck/${deck.id}`;
    };
  };

  $$("[data-open-deck]").forEach(btn=>{
    btn.onclick = () => {
      const id = btn.getAttribute("data-open-deck");
      location.hash = `#/deck/${id}`;
    };
  });

  $$("[data-study]").forEach(btn=>{
    btn.onclick = () => {
      const id = btn.getAttribute("data-study");
      const mode = btn.getAttribute("data-mode");
      startStudy(id, mode);
    };
  });

  $("#btn-exportAll").onclick = () => {
    const exportObj = exportAll();
    downloadJSON(`ox-grammar-backup-${new Date().toISOString().slice(0,10)}.json`, exportObj);
  };

  $("#btn-importAll").onclick = () => {
    openImportModal({mode:"all"});
  };
}

function exportAll(){
  // Export cards grouped by deck name for readability
  const decks = DATA.decks.map(d=>({id:d.id, name:d.name, createdAt:d.createdAt}));
  const cards = DATA.decks.flatMap(d=> d.cardIds.map(cid=>{
    const c = DATA.cards[cid];
    return {
      deck: d.name,
      prompt: c.prompt,
      answer: c.answer,
      explanation: c.explanation,
      tags: c.tags||[],
      createdAt: c.createdAt
    };
  }));
  return { version: 1, decks, cards };
}

function openImportModal({deckId=null, mode="deck"}){
  // mode: "deck" => import into specific deck; "all" => choose deck or create
  const deckOptions = DATA.decks.map(d=>`<option value="${d.id}">${escapeHtml(d.name)}</option>`).join("");
  const body = `
    <div class="small">JSON 파일 또는 텍스트(붙여넣기)를 지원합니다.</div>
    <hr class="sep"/>
    <div class="row">
      <div class="grow">
        <label>대상 카테고리</label>
        <select id="imp-deck" class="input">
          ${deckOptions}
        </select>
      </div>
      <button id="imp-newDeck" class="btn">+ 새 카테고리</button>
    </div>
    <div style="height:10px"></div>
    <label>붙여넣기(JSON)</label>
    <textarea id="imp-text" placeholder='예: [{"prompt":"...", "answer":"O", "explanation":"..."}]'></textarea>
    <div style="height:10px"></div>
    <label>파일 선택(JSON)</label>
    <input id="imp-file" class="input" type="file" accept="application/json,.json" />
    <div class="small" style="margin-top:8px">• answer는 O / X 로 입력하세요.</div>
  `;
  const footer = `
    <button class="btn ghost" data-close="1">닫기</button>
    <button id="imp-run" class="btn primary">가져오기</button>
  `;
  openModal("가져오기", body, footer);

  if(deckId){
    $("#imp-deck").value = deckId;
  }

  $("#imp-newDeck").onclick = () => {
    const name = prompt("새 카테고리 이름", "새 카테고리");
    if(!name) return;
    const d = ensureDeck(name.trim() || "새 카테고리");
    // refresh select
    $("#imp-deck").insertAdjacentHTML("afterbegin", `<option value="${d.id}">${escapeHtml(d.name)}</option>`);
    $("#imp-deck").value = d.id;
  };

  $("#imp-run").onclick = async () => {
    try{
      const targetDeckId = $("#imp-deck").value;
      const txt = ($("#imp-text").value||"").trim();
      const file = $("#imp-file").files?.[0] || null;

      let raw = txt;
      if(!raw && file){
        raw = await file.text();
      }
      if(!raw) throw new Error("붙여넣기 또는 파일을 선택하세요.");

      const cards = parseCardsJSON(raw);
      cards.forEach(c => createCard(targetDeckId, c));
      closeModal();
      toast(`${cards.length}개 가져오기 완료`);
      route();
    }catch(e){
      alert(e.message || String(e));
    }
  };
}

function renderDeckManage(deckId){
  const deck = deckById(deckId);
  if(!deck){
    location.hash = "#/";
    return;
  }
  setSubtitle(`관리: ${deck.name}`);
  const app = $("#app");

  const counts = deckCounts(deckId);
  const items = deck.cardIds.map(cid=>{
    const c = cardById(cid);
    const st = DATA.stats[cid] || {};
    const star = !!DATA.bookmarks?.[cid];
    const tags = (c.tags||[]).slice(0,4).map(t=>`<span class="badge">${escapeHtml(t)}</span>`).join(" ");
    return `
      <div class="item">
        <div class="prompt">${escapeHtml(c.prompt)}</div>
        <div class="meta">
          <span class="badge ${c.answer==='O'?'ok':'bad'}">정답 ${c.answer}</span>
          <span>정답 ${st.correct||0}</span>
          <span>오답 ${st.wrong||0}</span>
          ${tags}
        </div>
        <div class="actions">
          <button class="btn" data-edit="${cid}">편집</button>
          <button class="btn ${star?'primary':'ghost'}" data-star="${cid}">${star?'★':'☆'} 북마크</button>
          <button class="btn bad" data-del="${cid}">삭제</button>
        </div>
      </div>
    `;
  }).join("");

  app.innerHTML = `
    <div class="card">
      <div class="row space">
        <div>
          <div class="h1">${escapeHtml(deck.name)}</div>
          <div class="kpi">
            <span>총 <b>${counts.total}</b></span>
            <span class="badge bad">오답 <b>${counts.wrong}</b></span>
            <span class="badge star">★ <b>${counts.bookmarked}</b></span>
          </div>
        </div>
        <div class="row">
          <button class="btn primary" id="btn-studyAll">학습</button>
          <button class="btn bad" id="btn-studyWrong" ${counts.wrong>0?'':'disabled'}>오답만</button>
          <button class="btn" id="btn-studyStar" ${counts.bookmarked>0?'':'disabled'}>북마크</button>
        </div>
      </div>
      <hr class="sep"/>
      <div class="row">
        <button class="btn" id="btn-add">+ 문제 추가</button>
        <button class="btn" id="btn-import">가져오기</button>
        <button class="btn" id="btn-export">내보내기</button>
        <button class="btn bad" id="btn-delDeck">카테고리 삭제</button>
      </div>
    </div>

    <div class="card">
      <div class="h2">문제 목록</div>
      <div class="list">${items || `<div class="p">문제가 없습니다.</div>`}</div>
    </div>
  `;

  $("#btn-studyAll").onclick = () => startStudy(deckId, "all");
  $("#btn-studyWrong").onclick = () => startStudy(deckId, "wrong");
  $("#btn-studyStar").onclick = () => startStudy(deckId, "bookmark");

  $("#btn-add").onclick = () => openEditCardModal({deckId});
  $("#btn-import").onclick = () => openImportModal({deckId});
  $("#btn-export").onclick = () => {
    const deck = deckById(deckId);
    const exportCards = deck.cardIds.map(cid=>{
      const c = cardById(cid);
      return { prompt: c.prompt, answer: c.answer, explanation: c.explanation, tags: c.tags||[] };
    });
    downloadJSON(`deck-${sanitizeFile(deck.name)}.json`, exportCards);
  };

  $("#btn-delDeck").onclick = () => {
    openModal(
      "카테고리 삭제",
      `<div class="p">"${escapeHtml(deck.name)}" 카테고리를 삭제하면 안의 카드도 모두 삭제됩니다. 정말 삭제할까요?</div>`,
      `<button class="btn ghost" data-close="1">취소</button>
       <button id="confirmDelDeck" class="btn bad">삭제</button>`
    );
    $("#confirmDelDeck").onclick = () => {
      // delete all cards
      deck.cardIds.forEach(cid=>{
        delete DATA.cards[cid];
        delete DATA.stats[cid];
        if(DATA.bookmarks) delete DATA.bookmarks[cid];
      });
      DATA.decks = DATA.decks.filter(d=>d.id!==deckId);
      saveData();
      closeModal();
      toast("삭제 완료");
      location.hash = "#/";
    };
  };

  $$("[data-del]").forEach(btn=>{
    btn.onclick = () => {
      const cid = btn.getAttribute("data-del");
      if(confirm("이 문제를 삭제할까요?")){
        deleteCard(cid);
        route();
      }
    };
  });
  $$("[data-star]").forEach(btn=>{
    btn.onclick = () => {
      const cid = btn.getAttribute("data-star");
      toggleBookmark(cid);
      route();
    };
  });
  $$("[data-edit]").forEach(btn=>{
    btn.onclick = () => {
      const cid = btn.getAttribute("data-edit");
      openEditCardModal({deckId, cardId: cid});
    };
  });
}

function openEditCardModal({deckId, cardId=null}){
  const isEdit = !!cardId;
  const c = isEdit ? cardById(cardId) : {prompt:"", answer:"O", explanation:"", tags:[]};
  const body = `
    <div class="row" style="gap:14px; align-items:flex-start; flex-wrap:wrap">
      <div class="grow">
        <label>문장(문제)</label>
        <textarea id="ec-prompt" placeholder="예: The man whom I met yesterday is my teacher.">${escapeHtml(c.prompt||"")}</textarea>
      </div>
      <div style="min-width:140px">
        <label>정답</label>
        <select id="ec-answer" class="input">
          <option value="O" ${c.answer==="O"?"selected":""}>O</option>
          <option value="X" ${c.answer==="X"?"selected":""}>X</option>
        </select>
        <div style="height:10px"></div>
        <label>태그(쉼표)</label>
        <input id="ec-tags" class="input" placeholder="예: who/whom, 관계사" value="${escapeHtml((c.tags||[]).join(", "))}" />
      </div>
    </div>
    <div style="height:10px"></div>
    <label>해설</label>
    <textarea id="ec-exp" placeholder="간단한 규칙/근거를 적어주세요.">${escapeHtml(c.explanation||"")}</textarea>
  `;
  const footer = `
    <button class="btn ghost" data-close="1">취소</button>
    <button id="ec-save" class="btn primary">${isEdit?"저장":"추가"}</button>
  `;
  openModal(isEdit?"문제 편집":"문제 추가", body, footer);

  $("#ec-save").onclick = () => {
    const prompt = ($("#ec-prompt").value||"").trim();
    const answer = $("#ec-answer").value;
    const explanation = ($("#ec-exp").value||"").trim();
    const tags = ($("#ec-tags").value||"").split(",").map(x=>x.trim()).filter(Boolean);
    if(!prompt){ alert("문장을 입력하세요."); return; }
    if(isEdit){
      updateCard(cardId, {prompt, answer, explanation, tags});
      closeModal();
      toast("저장 완료");
      route();
    }else{
      createCard(deckId, {prompt, answer, explanation, tags});
      closeModal();
      toast("추가 완료");
      route();
    }
  };
}

function renderStudy(deckId, mode){
  const deck = deckById(deckId);
  if(!deck){ location.hash="#/"; return; }

  // If study state mismatched or missing, recreate
  if(!STATE.study || STATE.study.deckId !== deckId || STATE.study.mode !== mode){
    startStudy(deckId, mode);
    return;
  }

  const st = STATE.study;
  const app = $("#app");

  const currentId = st.queue[st.index];
  const card = cardById(currentId);
  if(!card){
    st.index++;
    if(st.index >= st.queue.length){
      st.finished = true;
    }
    route();
    return;
  }

  const total = st.queue.length;
  const idx = st.index + 1;
  const star = !!DATA.bookmarks?.[card.id];

  // When answered: show correctness, answer, explanation + next + AI variants (if wrong)
  const answered = !!st.answered;
  const isCorrect = answered ? (st.choice === card.answer) : null;

  const headerBadges = `
    <span class="badge">${escapeHtml(deck.name)}</span>
    <span class="badge">${mode==="wrong"?"오답만":mode==="bookmark"?"북마크":"전체"}</span>
    <span class="badge">${idx} / ${total}</span>
    ${card.tags?.length ? `<span class="badge">${escapeHtml(card.tags[0])}${card.tags.length>1?` +${card.tags.length-1}`:""}</span>` : ""}
  `;

  const resultRow = answered ? `
    <div class="row space" style="margin-top:12px">
      <div class="answerPill ${isCorrect?'ok':'bad'}">
        ${isCorrect ? "정답 ✅" : "오답 ❌"}
        <span class="mono">내 선택: ${st.choice}</span>
        <span class="mono">정답: ${card.answer}</span>
      </div>
      <div class="row">
        <button id="btn-star" class="btn ${star?'primary':'ghost'}">${star?'★':'☆'} 북마크</button>
      </div>
    </div>
  ` : `
    <div class="row space" style="margin-top:12px">
      <div class="badge">정답은 클릭 후 공개</div>
      <button id="btn-star" class="btn ${star?'primary':'ghost'}">${star?'★':'☆'} 북마크</button>
    </div>
  `;

  const explainBox = answered ? `
    <div class="studyExplain">
      <div class="label">해설</div>
      <div class="text">${escapeHtml(card.explanation || "해설 없음")}</div>
    </div>
  ` : "";

  const aiBtn = (answered && !isCorrect) ? `
    <button id="btn-ai" class="btn primary">AI 변형 ${SETTINGS.aiCount}개 풀기</button>
  ` : "";

  app.innerHTML = `
    <div class="card">
      <div class="row space">
        <div class="row" style="gap:8px; flex-wrap:wrap">${headerBadges}</div>
        <button id="btn-exit" class="btn ghost">나가기</button>
      </div>

      <div class="studyPrompt">${escapeHtml(card.prompt)}</div>

      ${resultRow}

      <hr class="sep"/>

      <div class="row">
        <button id="btn-O" class="btn ok" ${answered?'disabled':''}>O</button>
        <button id="btn-X" class="btn bad" ${answered?'disabled':''}>X</button>
        <div class="grow"></div>
        ${aiBtn}
        <button id="btn-next" class="btn" ${answered?'':'disabled'}>다음</button>
      </div>

      ${explainBox}
    </div>
  `;

  $("#btn-exit").onclick = () => {
    // preserve progress but just go back
    location.hash = `#/deck/${deckId}`;
  };

  $("#btn-star").onclick = () => {
    toggleBookmark(card.id);
    route();
  };

  $("#btn-O").onclick = () => applyAnswer("O");
  $("#btn-X").onclick = () => applyAnswer("X");

  $("#btn-next").onclick = () => {
    st.index++;
    st.answered = false;
    st.choice = null;
    st.lastCorrect = null;
    if(st.index >= st.queue.length){
      renderSummary(deckId, mode);
    }else{
      route();
    }
  };

  if($("#btn-ai")){
    $("#btn-ai").onclick = () => startVariantsForCurrent(card, {deckId, mode});
  }

  function applyAnswer(choice){
    if(st.answered) return;

    st.answered = true;
    st.choice = choice;
    const correct = (choice === card.answer);
    st.lastCorrect = correct;

    const stat = DATA.stats[card.id] || (DATA.stats[card.id] = {correct:0, wrong:0, lastReviewed:null});
    if(correct) stat.correct = (stat.correct||0) + 1;
    else stat.wrong = (stat.wrong||0) + 1;
    stat.lastReviewed = nowISO();
    saveData();
    route();
  }
}

function renderSummary(deckId, mode){
  const st = STATE.study;
  const deck = deckById(deckId);
  const app = $("#app");

  // compute session result by scanning queue stats? Not exact; keep simple
  const q = st.queue;
  let totalWrong = 0, totalCorrect = 0;
  for(const cid of q){
    const s = DATA.stats[cid];
    totalWrong += s?.wrong||0;
    totalCorrect += s?.correct||0;
  }

  app.innerHTML = `
    <div class="card">
      <div class="h1">학습 종료</div>
      <div class="p">${escapeHtml(deck?.name||"")}</div>
      <hr class="sep"/>
      <div class="kpi">
        <span>누적 정답 <b>${totalCorrect}</b></span>
        <span>누적 오답 <b>${totalWrong}</b></span>
      </div>
      <hr class="sep"/>
      <div class="row">
        <button class="btn primary" id="btn-again">다시하기</button>
        <button class="btn" id="btn-home">홈</button>
        <button class="btn bad" id="btn-wrong" ${deckCounts(deckId).wrong>0?'':'disabled'}>오답만</button>
      </div>
      <div class="small" style="margin-top:10px">
        오답만 모드에서 틀린 문제를 돌리다가, 틀린 문제는 <b>AI 변형</b>으로 바로 추가 훈련하면 효율이 좋습니다.
      </div>
    </div>
  `;
  $("#btn-again").onclick = () => startStudy(deckId, mode);
  $("#btn-home").onclick = () => location.hash = "#/";
  $("#btn-wrong").onclick = () => startStudy(deckId, "wrong");
}

async function startVariantsForCurrent(card, context){
  const n = clamp(parseInt(SETTINGS.aiCount||3,10)||3, 1, 8);

  openModal(
    "AI 변형 생성",
    `<div class="p">오답에 대한 변형문제 ${n}개를 생성 중…</div>
     <div class="small" style="margin-top:8px">네트워크/요금이 발생할 수 있습니다.</div>`,
    `<button class="btn ghost" data-close="1">닫기</button>`
  );

  try{
    const resp = await fetch("./api/variants", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        n,
        prompt: card.prompt,
        answer: card.answer,
        explanation: card.explanation || "",
        tags: card.tags || [],
        language: SETTINGS.aiLanguage || "ko",
      })
    });

    if(!resp.ok){
      const txt = await resp.text();
      throw new Error(`AI 오류: ${resp.status} ${txt}`);
    }
    const data = await resp.json();
    if(!data || !Array.isArray(data.variants) || !data.variants.length){
      throw new Error("AI 결과가 비어있습니다.");
    }

    // Build ephemeral variant queue
    const variants = data.variants.map((v, i) => ({
      id: uid("v"),
      prompt: String(v.prompt||"").trim(),
      answer: normalizeAnswer(v.answer)||"O",
      explanation: String(v.explanation||"").trim(),
      tags: ["AI변형", ...(card.tags||[])],
    })).filter(v => v.prompt && v.answer);

    if(!variants.length) throw new Error("변형 생성에 실패했습니다.");

    // Optional: store to deck
    if(SETTINGS.aiStoreVariants){
      let deck = DATA.decks.find(d=>d.name==="AI 변형");
      if(!deck) deck = ensureDeck("AI 변형");
      variants.forEach(v => createCard(deck.id, v));
      toast("AI 변형을 저장했습니다 (AI 변형 카테고리)");
    }

    // preserve study state reference for back
    STATE.variant = {
      source: {
        from: "study",
        deckId: context.deckId,
        mode: context.mode,
        index: STATE.study?.index ?? 0,
      },
      queue: variants,
      index: 0,
      answered: false,
      choice: null,
      correctCount: 0,
      wrongCount: 0,
    };

    closeModal();
    location.hash = "#/variant";
  }catch(e){
    closeModal();
    alert(e.message || String(e));
  }
}

function renderVariant(){
  const v = STATE.variant;
  if(!v){
    location.hash = "#/";
    return;
  }
  setSubtitle("AI 변형 훈련");
  const app = $("#app");

  const total = v.queue.length;
  const idx = v.index + 1;
  const card = v.queue[v.index];
  const answered = !!v.answered;
  const isCorrect = answered ? (v.choice === card.answer) : null;

  app.innerHTML = `
    <div class="card">
      <div class="row space">
        <div class="row" style="gap:8px; flex-wrap:wrap">
          <span class="badge star">AI 변형</span>
          <span class="badge">${idx} / ${total}</span>
          <span class="badge">정답 ${v.correctCount}</span>
          <span class="badge bad">오답 ${v.wrongCount}</span>
        </div>
        <button id="btn-backToStudy" class="btn ghost">원래로</button>
      </div>

      <div class="studyPrompt">${escapeHtml(card.prompt)}</div>

      ${answered ? `
        <div class="row space" style="margin-top:12px">
          <div class="answerPill ${isCorrect?'ok':'bad'}">
            ${isCorrect ? "정답 ✅" : "오답 ❌"}
            <span class="mono">내 선택: ${v.choice}</span>
            <span class="mono">정답: ${card.answer}</span>
          </div>
        </div>

        <div class="studyExplain">
          <div class="label">해설</div>
          <div class="text">${escapeHtml(card.explanation || "해설 없음")}</div>
        </div>
      ` : `
        <div class="row space" style="margin-top:12px">
          <div class="badge">정답은 클릭 후 공개</div>
        </div>
      `}

      <hr class="sep"/>

      <div class="row">
        <button id="v-O" class="btn ok" ${answered?'disabled':''}>O</button>
        <button id="v-X" class="btn bad" ${answered?'disabled':''}>X</button>
        <div class="grow"></div>
        <button id="v-next" class="btn" ${answered?'':'disabled'}>다음</button>
      </div>
    </div>
  `;

  $("#btn-backToStudy").onclick = () => {
    // return to study route (keep state)
    const src = v.source;
    STATE.variant = null;
    if(src?.from === "study"){
      location.hash = `#/study/${src.deckId}?mode=${src.mode}`;
    }else{
      location.hash = "#/";
    }
  };

  $("#v-O").onclick = () => apply("O");
  $("#v-X").onclick = () => apply("X");

  $("#v-next").onclick = () => {
    v.index++;
    v.answered = false;
    v.choice = null;
    if(v.index >= v.queue.length){
      // done
      const src = v.source;
      const cc = v.correctCount, wc = v.wrongCount;
      openModal(
        "AI 변형 완료",
        `<div class="kpi"><span>정답 <b>${cc}</b></span><span>오답 <b>${wc}</b></span></div>
         <div class="small" style="margin-top:10px">원래 학습으로 돌아가서 오답을 계속 돌리면 됩니다.</div>`,
        `<button class="btn primary" id="variantDone">원래로</button>`
      );
      $("#variantDone").onclick = () => {
        closeModal();
        STATE.variant = null;
        if(src?.from === "study"){
          location.hash = `#/study/${src.deckId}?mode=${src.mode}`;
        }else{
          location.hash = "#/";
        }
      };
    }else{
      route();
    }
  };

  function apply(choice){
    if(v.answered) return;
    v.answered = true;
    v.choice = choice;
    if(choice === card.answer) v.correctCount++;
    else v.wrongCount++;
    route();
  }
}

// helpers
function downloadJSON(filename, obj){
  const blob = new Blob([JSON.stringify(obj, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}

function sanitizeFile(name){
  return (name||"deck").replace(/[\\\/:*?"<>|]+/g,"_").slice(0,60);
}

function escapeHtml(s){
  return String(s??"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

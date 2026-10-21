/* Local review UI. The optional Windows launcher receives file paths only. */
(() => {
  'use strict';
  const C = window.BatReviewCore;
  const A = window.BatClassification;
  const N = window.BatSpeciesNames;
  const P = window.BatReviewPlan;
  const V = window.BatActivityChart;
  const E = window.BatActivityExport;
  const I = window.BatImportSummary;
  const B = window.BatBulkConfirmation;
  const K = window.BatKaleidoscope;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const checked = status => ['confirmed','corrected','uncertain','noise'].includes(status);
  const state = {source:null,data:null,parsed:null,rowById:new Map(),guided:[],speciesLabels:[],labelOptions:[],reviews:{},drafts:{},selections:{},reviewer:'',minimal:true,minimalStarted:false,resultsView:false,activityChartMode:'pie',includeCommonPipistrelle:true,tab:'pending',species:'',search:'',sort:'guided',selected:null,page:0,autoNext:true,undo:[],encodingWarning:'',policy:A.normalizePolicy(),classification:null,reviewPlan:null};
  const STORAGE = 'plecotus.project.v1';
  const PREFERENCES = 'plecotus.preferences.v1';
  let reviewerPreferenceSet=false, wavViewer='kaleidoscope', viewerExecutables={kaleidoscope:'',chirosurf:''}, settingsViewer='kaleidoscope', settingsExecutables={}, openingRecording=false, exportingImage=false;
  const localToken=document.querySelector('meta[name="plecotus-local-token"]')?.content || '';
  let localLauncher=Boolean(localToken) && location.origin==='http://127.0.0.1:4174';
  const PAGE_SIZE = 50;
  let toastTimer, saveTimer, pendingOpen;
  const num = n => n == null ? '—' : Number(n).toLocaleString('fr-BE', {maximumFractionDigits:3});
  const ratio = n => n == null ? '—' : (n * 100).toLocaleString('fr-BE', {minimumFractionDigits:1, maximumFractionDigits:1}) + ' %';
  // Translate interface outcomes while keeping source cells and species labels intact.
  const outcomeLabel = label => {
    const name=N?.resolve(label);
    return name?.category==='unidentified'?`${name.scientificName} · ${name.frenchName}`:({'Noise':'Bruit','Unclassified':'Non classé','Pending classification':'Classification en attente','Uncertain / unresolved':'Identification incertaine / non résolue'}[label] || label);
  };
  const autoLabel = row => row.kind==='noise'?'Bruit (Noise)':row.kind==='noid'?'Sans identification (NoID)':row.kind==='unclassified'?'Non classé':row.autoId;
  const review = row => state.reviews[row.id] || {status:row.manualId ? 'imported' : 'unreviewed',label:row.manualId || '',notes:'',reviewer:'',timestamp:''};
  const assignment = row => state.classification?.byId.get(row.id);
  const statusLabel = result => result?.origin==='pending' && result.role==='waiting' ? 'En attente des contrôles' : ({'inferred':result?.method==='proportion'?'Répartition au prorata':'Auto-ID validé','inferred-noise':'Bruit au prorata','ignored-noise':'Bruit ignoré','inferred-uncertain':'Incertitude au prorata','needs-review':'À vérifier','imported':'Manuel importé','draft':'Brouillon','confirmed':'Confirmé','corrected':'Attribué manuellement','uncertain':'Incertain','noise':'Bruit vérifié'}[result?.status] || 'À vérifier');
  function recalculate() {
    if(!state.data) return;
    state.classification=A.classify(state.data,state.reviews,state.policy,state.drafts,state.selections);
    state.reviewPlan=P.summarize(state.classification);
    const groupOrder=new Map(state.classification.groups.map((g,i)=>[g.key,i]));
    const priority=r=>{const a=assignment(r);return a.origin==='manual'?5:a.origin==='inferred'?4:a.role==='waiting'?3:a.role==='reference'?0:a.role==='audit'?1:2;};
    state.guided=[...state.data.rows].sort((a,b)=>groupOrder.get(assignment(a).groupKey)-groupOrder.get(assignment(b).groupKey)||priority(a)-priority(b)||assignment(a).rank-assignment(b).rank||a.index-b.index);
  }
  function toast(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,5000); }
  function renderReviewerPreference() { $('reviewer-settings').textContent='⚙ Réglages';$('reviewer-settings').title=state.reviewer?'Vérificateur : '+state.reviewer:'Réglages du vérificateur et du logiciel d’ouverture des WAV'; }
  function savePreferences() {
    try{localStorage.setItem(PREFERENCES,JSON.stringify({reviewer:state.reviewer,wavViewer,kaleidoscopeExecutable:viewerExecutables.kaleidoscope,chirosurfExecutable:viewerExecutables.chirosurf}));return true;}
    catch{toast('Réglages retenus pour cette session. Le navigateur ne permet pas de les mémoriser.');return false;}
  }
  function setReviewerDefault(value) {
    state.reviewer=String(value || '').trim();reviewerPreferenceSet=true;renderReviewerPreference();
    return savePreferences();
  }
  try{
    const preferences=JSON.parse(localStorage.getItem(PREFERENCES) || 'null');
    if(preferences && typeof preferences.reviewer==='string'){state.reviewer=preferences.reviewer;reviewerPreferenceSet=true;}
    for(const id of ['kaleidoscope','chirosurf']){
      const value=preferences?.[id+'Executable'];
      if(typeof value==='string')try{viewerExecutables[id]=K.normalizeExecutable(value,id);}catch{}
    }
    if(typeof preferences?.wavViewer==='string')try{wavViewer=K.viewerInfo(preferences.wavViewer).id;}catch{}
  }catch{}
  renderReviewerPreference();
  syncViewMode();
  function renderViewerSettings() {
    const viewer=K.viewerInfo(settingsViewer);
    $('wav-viewer').value=viewer.id;
    $('wav-viewer-executable-label').textContent='Chemin de l’exécutable '+viewer.name;
    $('wav-viewer-executable').value=settingsExecutables[viewer.id] || '';
    $('wav-viewer-executable').placeholder='C:\\Logiciels\\'+viewer.executableHint;
    $('wav-viewer-path-note').textContent='Dans l’Explorateur Windows, faites Maj + clic droit sur '+viewer.executableHint+' (ou sa version numérotée pour ChiroSurf), puis « Copier en tant que chemin d’accès ». Collez le chemin ici.';
    if(viewer.id==='kaleidoscope')$('wav-viewer-path-note').textContent='Dans l’Explorateur Windows, faites Maj + clic droit sur kaleidoscope.exe, puis « Copier en tant que chemin d’accès ». Collez le chemin ici.';
    $('wav-viewer-connection').textContent=localLauncher?'Lanceur Windows actif. Les WAV s’ouvriront dans '+viewer.name+' après enregistrement des réglages.':'Pour ouvrir les WAV en un clic, démarrez Plecotus avec Demarrer-Plecotus.cmd, fourni dans l’archive. Le navigateur seul ne peut pas lancer un exécutable Windows.';
  }
  function openSettings(message='') {
    $('default-reviewer').value=state.reviewer;settingsViewer=wavViewer;settingsExecutables={...viewerExecutables};renderViewerSettings();
    $('settings-error').textContent=message;$('settings-error').hidden=!message;
    $('stop-local-launcher').hidden=!localLauncher;
    $('reviewer-dialog').showModal();
  }
  async function openRecording(row) {
    if(openingRecording)return;
    const viewer=K.viewerInfo(wavViewer), executable=viewerExecutables[viewer.id];
    if(!executable){openSettings('Renseignez d’abord le chemin de l’exécutable '+viewer.name+'.');$('wav-viewer-executable').focus();return;}
    if(!localLauncher){openSettings('L’ouverture directe nécessite le lanceur Windows Demarrer-Plecotus.cmd.');return;}
    let file;try{file=K.recordingPath(row);}catch(error){toast(error.message);return;}
    openingRecording=true;const button=$('open-recording');if(button)button.disabled=true;
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch('/api/open-recording',{method:'POST',headers:{'Content-Type':'application/json','X-Plecotus-Token':localToken},body:JSON.stringify({viewer:viewer.id,executable,file}),signal:controller.signal});
      if(response.status===404)throw new Error('Le lanceur doit être mis à jour. Dans Réglages, arrêtez-le, puis relancez Demarrer-Plecotus.cmd depuis le dossier de la nouvelle version et rechargez la page.');
      const result=await response.json();if(!response.ok || !result.ok)throw new Error(result.error || 'L’ouverture dans '+viewer.name+' a échoué.');
      toast(`Ouverture demandée dans ${viewer.name}. Retrouvez le canal ${row.channel || '0'} et le décalage ${row.offset || '0'} s dans le logiciel.`);
    }catch(error){toast(error.name==='AbortError' || error instanceof TypeError?'Lanceur local indisponible. Relancez Demarrer-Plecotus.cmd, puis rechargez la page.':error.message);}
    finally{clearTimeout(timeout);openingRecording=false;const current=$('open-recording');if(current)current.disabled=false;}
  }
  function setViewMode(minimal) {
    state.minimal=minimal;state.resultsView=false;
    if(minimal)state.minimalStarted=false;
    syncViewMode();
    if(state.data){
      if(!minimal){const rows=visibleRows();if(!rows.some(r=>r.id===state.selected))state.selected=rows[0]?.id || null;}
      render();
    }
  }
  function syncViewMode() {
    document.body.classList.toggle('minimal-mode',state.minimal);
    document.body.classList.remove('results-view');
    $('view-mode').textContent=state.minimal?'Vue complète':'Mode minimaliste';
    $('view-mode').setAttribute('aria-pressed',String(!state.minimal));
  }
  function project() { return {format:'plecotus-review',version:3,source:state.source,reviews:state.reviews,drafts:state.drafts,selections:state.selections,reviewer:state.reviewer,policy:state.policy,encodingWarning:state.encodingWarning,exportedAt:new Date().toISOString()}; }
  function persist() {
    if (!state.source) return;
    try { localStorage.setItem(STORAGE,JSON.stringify(project())); $('save-status').textContent='Enregistré dans ce navigateur';$('storage-warning').hidden=true; }
    catch { $('save-status').textContent='Enregistrer une sauvegarde du projet';$('storage-warning').hidden=false;toast('Le stockage du navigateur est indisponible ou plein. Utilisez « Enregistrer le projet » pour conserver vos décisions.'); }
  }
  function schedulePersist() { clearTimeout(saveTimer); $('save-status').textContent='Enregistrement du brouillon…'; saveTimer=setTimeout(()=>{recalculate();renderCounters();renderSummary();renderSpeciesWorkflow();renderQueue();renderMinimalOverview();renderReviewProgress();updateDetailClassification();persist();},350); }
  function download(name,body,type) {
    const url=URL.createObjectURL(new Blob([body],{type})); const a=document.createElement('a'); a.href=url; a.download=name; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const baseName = () => (state.source?.name || 'id.csv').replace(/\.[^.]+$/,'');
  function saveProject() { if(!state.source) return; download(baseName()+'.plecotus.json',JSON.stringify(project(),null,2),'application/json'); toast('Sauvegarde téléchargée : elle contient le CSV, les décisions et les brouillons.'); }
  function requestOpen(callback) {
    if(state.source && (Object.keys(state.reviews).length || Object.keys(state.drafts).length)) {pendingOpen=callback;$('replace-dialog').showModal();} else callback();
  }
  function acceptSource(source,extras={}) {
    if(!source || typeof source.text!=='string' || typeof source.name!=='string') throw new Error('Le projet ne contient aucun CSV source valide.');
    const parsed=C.parseCSV(source.text); const data=C.analyze(parsed.headers,parsed.records);data.headers=parsed.headers;
    if(parsed.headers.filter(h=>h.toUpperCase().replace(/[^A-Z0-9]/g,'')==='SEMIMANUALID').length>1)throw new Error('Plusieurs colonnes désignent SEMIMANUAL ID. Gardez une seule colonne avant l’import.');
    const policy=A.normalizePolicy(extras.version && extras.version<3 ? extras.policy || {version:1} : extras.policy || state.policy);
    if(!data.rows.length) throw new Error('Ce CSV ne contient aucun contact.');
    if(data.columns.file < 0) throw new Error('La colonne IN FILE (ou File) est introuvable. Importez un id.csv ou un export Kaleidoscope compatible.');
    const reviews={}; const drafts={}; const rowById=new Map(data.rows.map(r=>[r.id,r]));
    for(const [id,r] of Object.entries(extras.reviews || {})) {
      if(!rowById.has(id) || !r || !checked(r.status) || typeof r.label!=='string' || !r.label.trim()) throw new Error('Le projet contient une décision de vérification invalide.');
      const row=rowById.get(id);
      if(r.status==='confirmed' && (row.kind!=='species' || r.label.trim()!==row.autoId)) throw new Error('Une étiquette confirmée du projet ne correspond pas à la suggestion source.');
      if(r.status==='noise' && r.label!=='Noise') throw new Error('Une décision « Bruit » contient une étiquette incohérente.');
      reviews[id]={status:r.status,label:r.label,notes:String(r.notes || ''),reviewer:String(r.reviewer || ''),timestamp:String(r.timestamp || '')};
    }
    for(const [id,d] of Object.entries(extras.drafts || {})) if(rowById.has(id) && d && typeof d==='object') drafts[id]={status:['confirmed','corrected','uncertain','noise'].includes(d.status)?d.status:'',label:String(d.label || ''),notes:String(d.notes || ''),reviewer:String(d.reviewer || '')};
    const guided=[];
    const speciesLabels=[...new Set(data.rows.filter(r=>r.kind==='species').map(r=>r.autoId))].sort();
    const labelOptions=[...new Set([...speciesLabels,...N.IDENTIFICATION_LABELS.map(item=>item.label),'Myotis sp.','Plecotus sp.','Pipistrellus sp.','Groupe Nyctalus / Eptesicus / Vespertilio'])].sort();
    const selections=extras.version===3 && extras.selections && typeof extras.selections==='object' && !Array.isArray(extras.selections)?extras.selections:{};
    const reviewerDefault=reviewerPreferenceSet?state.reviewer:String(extras.reviewer || state.reviewer || '');
    Object.assign(state,{source,parsed,data,rowById,guided,speciesLabels,labelOptions,reviews,drafts,selections,policy,reviewer:reviewerDefault,minimal:true,minimalStarted:false,resultsView:false,encodingWarning:String(extras.encodingWarning || ''),tab:'pending',species:'',search:'',selected:null,page:0,undo:[]});
    $('activities-image-status').textContent='';
    syncViewMode();
    if(reviewerDefault && !reviewerPreferenceSet)setReviewerDefault(reviewerDefault);
    renderReviewerPreference();
    recalculate();
    state.selected=visibleRows()[0]?.id || data.rows[0].id;
    $('search').value=''; $('sort').value=state.sort; $('welcome').hidden=true; $('workspace').hidden=false;
    ['save-project','export'].forEach(id=>$(id).disabled=false); render(); persist();
  }
  async function loadCSV(file) {
    if(!file) return;
    try {
      if(file.size>50*1024*1024) throw new Error('Cette version dans le navigateur accepte les CSV de moins de 50 Mo.');
      const bytes=new Uint8Array(await file.arrayBuffer()); let text,warning='';
      if(bytes[0]===255 && bytes[1]===254) text=new TextDecoder('utf-16le').decode(bytes);
      else if(bytes[0]===254 && bytes[1]===255) text=new TextDecoder('utf-16be').decode(bytes);
      else { try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('windows-1252').decode(bytes);warning='CSV décodé en Windows-1252. Les exports utilisent UTF-8 ; vérifiez les accents avant de rouvrir le fichier.';} }
      acceptSource({name:file.name,text},{encodingWarning:warning});
      toast(`${state.data.rows.length.toLocaleString('fr-BE')} contacts importés. Commencez par les vérifications obligatoires ; les attributions éligibles seront disponibles une fois ces contrôles validés.`);
    } catch(error) {toast(error.message);} finally {$('csv-file').value='';}
  }
  async function loadProject(file) {
    if(!file) return;
    try {
      if(file.size>75*1024*1024) throw new Error('Ce projet est trop volumineux pour cette première version.');
      let p;try{p=JSON.parse(await file.text());}catch{throw new Error('Le fichier de projet ne contient pas un JSON valide.');}
      if(!p || p.format!=='plecotus-review'||![1,2,3].includes(p.version)) throw new Error('Choisissez un fichier JSON de projet Plecotus version 1, 2 ou 3.');
      acceptSource(p.source,p);toast(p.version<3?'Projet ouvert : décisions conservées, ancienne règle prudente remplacée par la procédure par espèce.':'Projet ouvert avec ses décisions, ses sélections et ses règles.');
    }catch(error){toast(error.message);}finally{$('project-file').value='';}
  }
  function visibleRows() {
    if(!state.data) return [];
    if(state.minimal)return state.guided.filter(r=>assignment(r).requiresReview);
    const query=state.search.toLowerCase();
    return (state.sort==='source'?state.data.rows:state.guided).filter(r=>{
      const rev=review(r);const a=assignment(r);
      if(state.species && a.groupKey!==state.species) return false;
      if(query && ![r.file,r.folder,r.autoId,autoLabel(r),rev.label,outcomeLabel(rev.label),a?.label,outcomeLabel(a?.label),rev.notes,r.date,r.time,r.offset].join(' ').toLowerCase().includes(query)) return false;
      if(state.tab==='pending') return a.requiresReview;
      if(state.tab==='reviewed') return a.origin==='manual';
      if(state.tab==='anchors') return a.isAnchor;
      if(state.tab==='audits') return a.role==='audit';
      if(state.tab==='waiting') return a.role==='waiting' && a.origin==='pending';
      if(state.tab==='inferred') return a.origin==='inferred';
      if(state.tab==='noid') return ['noid','unclassified'].includes(r.kind);
      if(state.tab==='noise') return r.kind==='noise';
      return true;
    });
  }
  function render() {
    if(!state.data) return;
    recalculate();
    const rows=state.data.rows; const metrics=state.classification.metrics;
    $('dataset-name').textContent=state.source.name;
    $('dataset-caption').textContent=`${state.source.name} · ${rows.length.toLocaleString('fr-BE')} contacts · ${state.source.name==='example-id.csv'?'Données fictives de démonstration · ':''}${metrics.waiting} contacts en attente des contrôles de leur groupe`;
    renderCounters();
    renderSummary();
    renderSpeciesWorkflow();
    $('species-list').innerHTML=state.classification.groups.map(group=>`<button class="nav-button ${state.species===group.key?'active':''}" data-species="${esc(group.key)}"><b>${esc(outcomeLabel(group.autoId))}</b><span>${group.requiredCount} / ${group.total}</span></button>`).join('');
    $('all-groups').classList.toggle('active',!state.species);
    document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===state.tab));
    const warnings=[...(state.parsed.warnings || []),...(state.data.warnings || []),...(state.encodingWarning?[state.encodingWarning]:[])].map(w=>typeof w==='string'?w:JSON.stringify(w));
    const imported=rows.filter(r=>review(r).status==='imported').length;
    if(imported) warnings.push(`${imported} valeurs MANUAL ID importées sont utilisées comme décisions manuelles existantes. Leur provenance reste indiquée « Manuel importé ».`);
    $('data-banner').hidden=!warnings.length;
    if(warnings.length) $('data-banner').innerHTML=`<details><summary>${warnings.length} remarque${warnings.length>1?'s':''} sur les données ou leur import — à examiner avant de se fier au classement</summary><ul>${warnings.slice(0,50).map(w=>`<li>${esc(w)}</li>`).join('')}</ul>${warnings.length>50?'<p>Les 50 premières remarques sont affichées. Les anomalies propres à chaque contact figurent dans sa fiche et dans le journal de vérification.</p>':''}</details>`;
    renderImportedManuals();renderQueue();renderMinimalOverview();renderFocusedContact();
  }
  function renderImportedManuals() {
    const imported=I.summarize(state.data,state.classification);
    $('imported-manual-banner').hidden=!imported.filledCount;
    if(!imported.filledCount)return;
    $('imported-manual-title').textContent=`${num(imported.filledCount)} MANUAL ID déjà renseigné${imported.filledCount===1?'':'s'} dans ce CSV`;
    $('imported-manual-note').textContent=`${num(imported.activeCount)} identification${imported.activeCount===1?'':'s'} importée${imported.activeCount===1?'':'s'} reprise${imported.activeCount===1?'':'s'} comme décision${imported.activeCount===1?'':'s'} manuelle${imported.activeCount===1?'':'s'}. Ces valeurs comptent dans les objectifs de contrôle et gardent la priorité sur les attributions automatiques.${imported.overriddenCount?' '+num(imported.overriddenCount)+' valeur(s) source remplacée(s) par une décision du projet.':''} ${num(state.reviewPlan.remaining)} contrôles manuels restent prévus, références et échantillons compris.`;
    const warnings=[];
    if(imported.unresolvedCount)warnings.push(`${num(imported.unresolvedCount)} valeur${imported.unresolvedCount===1?' exprime':'s expriment'} une identification non résolue.`);
    if(imported.unrecognizedCount)warnings.push(`${num(imported.unrecognizedCount)} valeur${imported.unrecognizedCount===1?' est un libellé libre non reconnu':'s sont des libellés libres non reconnus'}, parfois des notes de travail. Ces textes sont conservés tels quels et peuvent entrer dans le prorata et le tableau d’activité.`);
    if(warnings.length)warnings.push('Toute valeur MANUAL ID non vide compte actuellement comme une décision existante et ne déclenche pas, à elle seule, une nouvelle vérification. Consultez ces libellés avant de démarrer.');
    $('imported-manual-warning').hidden=!warnings.length;
    $('imported-manual-warning').textContent=warnings.join(' ');
    const modes={reference:'Référence à contrôler',autoid:'Validation directe',proportion:'Échantillon puis prorata',manual:'Contrôle individuel'};
    $('imported-manual-details').innerHTML=`<p>Une référence déjà renseignée n’est pas redemandée. Pour un échantillon, les décisions importées contribuent à la cible, mais chaque contact sélectionné encore vide reste obligatoire, même si la cible numérique est déjà atteinte.</p><div class="summary-scroll"><table><thead><tr><th>AUTO-ID</th><th>MANUAL ID source</th><th>Règle actuelle</th><th>Contrôles restants</th></tr></thead><tbody>${state.classification.groups.map(g=>{const source=imported.groups.find(item=>item.key===g.key);const plan=state.reviewPlan.groups.find(item=>item.key===g.key);return `<tr><td>${esc(outcomeLabel(g.autoId))}</td><td>${num(source?.sourceCount || 0)}</td><td>${esc(g.kind==='noise' && state.policy.ignoreNoise?'Noise ignorés par défaut':modes[g.mode])}</td><td>${num(plan.remaining)}</td></tr>`;}).join('')}</tbody></table></div><h3>Libellés présents dans MANUAL ID</h3><div class="summary-scroll"><table><thead><tr><th>Libellé source</th><th>Contacts</th><th>Reconnaissance du libellé</th></tr></thead><tbody>${imported.labels.map(item=>`<tr><td>${esc(item.label)}</td><td>${num(item.count)}</td><td>${esc(!item.known?'Libellé libre non reconnu':item.category==='noise'?'Bruit':['pending','uncertain','unidentified'].includes(item.category)?'Identification non résolue':'Espèce ou groupe reconnu')}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function planGroupName(group) {
    const name=N.resolve(group.autoId);
    return name.known && (name.isSpecies || name.category==='unidentified')?name.frenchName:outcomeLabel(group.autoId);
  }
  const planGroupCode = group => ({noise:'Bruit',noid:'NoID',unclassified:'Non classé'}[group.kind] || group.autoId);
  function renderMinimalOverview() {
    if(!state.reviewPlan)return;
    const groups=state.reviewPlan.groups.filter(g=>g.remaining>0);
    const max=Math.max(1,...groups.map(g=>g.remaining));
    const ignored=state.classification.metrics.ignored;
    $('overview-note').textContent=`${num(state.reviewPlan.remaining)} contrôles manuels restants.${ignored?' '+num(ignored)+' contacts Noise ignorés.':''} Les objectifs sont ajustés après la vérification des références et les changements d’échantillon.`;
    $('review-chart').innerHTML=`<div class="review-chart-columns" role="list" aria-label="Contrôles manuels restants par identification automatique">${groups.map(g=>`<div class="review-chart-column" role="listitem" title="${esc(planGroupName(g))} : ${num(g.remaining)} contrôle(s) restant(s)${g.conditional?' · un échantillon pourra être requis après la référence':''}"><div class="review-chart-value">${num(g.remaining)}</div><div class="review-chart-bar-track" aria-hidden="true"><div class="review-chart-bar" style="height:${100*g.remaining/max}%"></div></div><div class="review-chart-label">${esc(planGroupCode(g))}${planGroupName(g)!==planGroupCode(g)?`<span class="review-chart-name">${esc(planGroupName(g))}</span>`:''}</div></div>`).join('')}</div>`;
    $('minimal-start').disabled=!state.guided.some(r=>assignment(r).requiresReview);
  }
  function progressMarkup(title,group,subtitle='') {
    const progress=group.total?Math.max(0,Math.min(100,100*group.completed/group.total)):100;
    return `<div class="review-progress-title"><div class="review-progress-label"><strong>${esc(title)}</strong>${subtitle?`<small>${esc(subtitle)}</small>`:''}</div><div class="review-progress-count">${num(group.remaining)}<small>restant${group.remaining===1?'':'s'}</small></div></div><div class="review-progress-track" role="progressbar" aria-label="${esc(subtitle || title)} · contrôles manuels effectués" aria-valuemin="0" aria-valuemax="${group.total}" aria-valuenow="${group.completed}" aria-valuetext="${num(group.completed)} sur ${num(group.total)} effectués ; ${num(group.remaining)} restants"><div class="review-progress-fill" style="width:${progress}%"></div><span class="review-progress-tick" style="left:${progress}%" aria-hidden="true"></span></div><p class="review-progress-note">${num(group.completed)} / ${num(group.total)} contrôles effectués</p>`;
  }
  function renderReviewProgress() {
    const row=state.rowById.get(state.selected);
    if(!row || !state.reviewPlan)return;
    const group=state.reviewPlan.groups.find(g=>g.key===assignment(row).groupKey);
    const explanation=P.explain(speciesGroup(group.key),group,assignment(row));
    $('species-progress').innerHTML=progressMarkup(planGroupCode(group),group,planGroupName(group)!==planGroupCode(group)?planGroupName(group):'');
    $('total-progress').innerHTML=progressMarkup('Au total',state.reviewPlan,'Ensemble du fichier');
    $('review-rule-title').textContent='Pourquoi '+planGroupCode(group)+' ?';
    $('review-rule-reason').textContent=explanation.reason;
    $('review-rule-calculation').textContent=explanation.calculation;
    const contactReason=$('review-contact-reason');if(contactReason)contactReason.textContent=explanation.contactReason;
  }
  function renderFocusedContact() {
    const next=state.minimal?state.guided.find(r=>assignment(r).requiresReview):null;
    const ready=state.classification.metrics.pending===0;
    if(!ready)state.resultsView=false;
    const overview=state.minimal && !state.minimalStarted && !ready && !!next;
    const active=state.minimal && state.minimalStarted && !!next && !state.resultsView;
    document.body.classList.toggle('results-view',state.minimal && state.resultsView);
    document.body.classList.toggle('review-active',active);
    $('minimal-overview').hidden=!overview;
    $('minimal-progress').hidden=!active;
    $('minimal-complete').hidden=!state.minimal || !!next || state.resultsView || overview;
    $('minimal-focus-caption').hidden=!active;
    document.querySelector('.review-layout').hidden=state.minimal && !active;
    if(!state.minimal){renderDetail();return;}
    if(overview){$('detail').innerHTML='';return;}
    if(next){
      state.selected=next.id;const a=assignment(next);
      const step=a.role==='reference'?'Référence de l’espèce':a.role==='audit'?'Contrôle de l’échantillon':'Identification manuelle';
      const name=N.resolve(next.autoId);const caption=name.known && name.isSpecies?name.frenchName:autoLabel(next);
      $('minimal-focus-caption').innerHTML=`<strong>${esc(step)} · ${esc(caption)}</strong><span>Prochain contact à vérifier</span>`;
      renderDetail();renderReviewProgress();return;
    }
    // An intentionally shortened selection can leave a quota deficit without a next pick.
    // Keep the explicit selection intact and lead the reviewer to its controls.
    const card=$('minimal-complete');const m=state.classification.metrics;
    card.querySelector('.completion-mark').textContent=ready?'✓':'!';
    card.querySelector('.eyebrow').textContent=ready?'CONTRÔLES TERMINÉS':'ÉCHANTILLON À COMPLÉTER';
    card.querySelector('h2').textContent=ready?'Vos contrôles sont terminés.':'L’objectif manuel n’est pas encore atteint.';
    card.querySelector('p').textContent=ready?'Consultez le tableau des activités ou vérifiez d’autres contacts.'+(m.unresolved?' '+num(m.unresolved)+' identification(s) restent non résolues.':''):'Complétez votre sélection ou adaptez son objectif dans la vue complète pour attribuer les '+num(m.pending)+' contacts en attente.';
    $('minimal-results').textContent=ready?'Voir le tableau final':'Adapter l’échantillon';
    $('minimal-all').hidden=!ready;
    $('minimal-undo').hidden=!state.undo.length;
    $('detail').innerHTML='';
  }
  function renderCounters() {
    if(!state.classification)return;const metrics=state.classification.metrics;const done=metrics.manual+metrics.inferred+metrics.ignored;
    $('sidebar-count').textContent=metrics.total.toLocaleString('fr-BE'); $('progress-label').textContent=`${done.toLocaleString('fr-BE')} / ${metrics.total.toLocaleString('fr-BE')}`; $('progress-fill').style.width=(100*done/metrics.total)+'%';
    $('pending-count').textContent=metrics.required;
    $('stats').innerHTML=[['Contacts',metrics.total,'≋',''],[state.minimal?'À vérifier':'Vérifications obligatoires restantes',state.minimal?state.reviewPlan.remaining:metrics.required,'◇','amber'],[state.minimal?'Semi-manuels':'Attribués par les règles',metrics.inferred,'↗',''],[state.minimal?'Vérifiés':'Vérifiés manuellement',metrics.manual,'✓',''],['Noise ignorés',metrics.ignored,'∅','']].map(([label,value,symbol,cls])=>`<div class="stat ${cls}"><div><div class="value">${value.toLocaleString('fr-BE')}</div><div class="label">${label}</div></div><span class="symbol">${symbol}</span></div>`).join('');
  }
  function renderSummary() {
    const c=state.classification;const m=c.metrics;const complete=m.required===0 && m.waiting===0;
    $('summary-state').textContent=complete?`Vérifications terminées${m.unresolved?' · '+m.unresolved+' identifications non résolues':''} · les totaux issus des règles restent des estimations`:'Incomplet · vérifications restantes';
    $('summary-state').className=complete?'summary-complete':'summary-pending';
    $('summary-explanation').textContent=`${m.manual} décisions manuelles + ${m.inferred} attributions semi-manuelles + ${m.ignored} Noise ignorés + ${m.pending} en attente = ${m.total} contacts. ${m.unresolved-m.pending} résultats attribués restent incertains ou sans identification. Le prorata est une extrapolation statistique ; une ligne ainsi remplie n’a pas été identifiée acoustiquement. Toute décision manuelle prime dans ce bilan.`;
    const categories={taxon:'Étiquette d’espèce ou de groupe',uncertain:'Identification de chauve-souris non résolue',unresolved:'Chauve-souris non identifiée',noise:'Bruit / exclu',pending:'Résultat en attente'};
    $('summary-body').innerHTML=c.summary.map(s=>`<tr class="summary-${esc(s.category)}"><td><b>${esc(outcomeLabel(s.label))}</b><small>${esc(categories[s.category] || s.category)}</small></td><td>${s.manual.toLocaleString('fr-BE')}</td><td>${s.inferred.toLocaleString('fr-BE')}</td><td>${s.ignored.toLocaleString('fr-BE')}</td><td><strong>${s.total.toLocaleString('fr-BE')}</strong></td></tr>`).join('');
    $('summary-footer').innerHTML=`<tr><td>Tous les contacts</td><td>${m.manual}</td><td>${m.inferred}</td><td>${m.ignored}</td><td>${m.total}</td></tr>`;
    $('policy-caption').textContent=`Procédure par espèce · majorité stricte > 50 % avec rapport > 0,6 · échantillon par défaut ${num(state.policy.samplePercent)} % · objectifs individuels modifiables`;
    renderActivities();
  }
  function renderActivities() {
    const c=state.classification;const rows=N.activityRows(c.summary);const ready=c.metrics.pending===0;
    const excluded=c.summary.filter(s=>!N.isActivitySummaryEntry(s));
    const outside=excluded.map(s=>`${num(s.total)} ${outcomeLabel(s.label)}`).join(' · ');
    const unknown=rows.some(row=>!row.known);
    $('activities-state').textContent=ready?'Tableau final · contrôles terminés':'Provisoire · classification à terminer';
    $('activities-state').className=ready?'summary-complete':'summary-pending';
    $('activities-noise-count').textContent=num(c.metrics.ignored);
    $('activities-noise-label').textContent=c.metrics.ignored===1?'contact Noise ignoré':'contacts Noise ignorés';
    const unidentified=rows.filter(row=>row.category==='unidentified').reduce((total,row)=>total+row.contacts,0);
    $('activities-note').textContent=(ready?'Les contacts attribués à une espèce, un groupe ou une étiquette NoID sont totalisés ci-dessous.':'Ce tableau évolue pendant les contrôles. Son export sera disponible lorsque tous les contrôles seront terminés.')+` Chauves-souris non identifiées (les cinq étiquettes NoID) : ${num(unidentified)} contact(s).`+(outside?' Hors tableau : '+outside+'.':'')+(unknown?' Les libellés libres non reconnus sont conservés sans leur inventer un nom scientifique.':'');
    $('activities-body').innerHTML=rows.map(row=>`<tr><td>${row.isSpecies?`<i>${esc(row.scientificName)}</i>`:`<span class="unknown-label">${esc(row.scientificName)}</span>`}</td><td>${esc(row.frenchName)}</td><td><strong>${num(row.contacts)}</strong></td></tr>`).join('') || '<tr><td colspan="3">Aucun contact attribué à une espèce ou un groupe.</td></tr>';
    $('activities-footer').innerHTML=`<tr><td colspan="2">Total des contacts du tableau</td><td>${num(rows.reduce((total,row)=>total+row.contacts,0))}</td></tr>`;
    $('activities-export').disabled=$('export-activities').disabled=!ready;
    renderActivityChart(rows);
  }
  function renderActivityChart(rows) {
    if(!state.classification)return;
    const chart=N.chartRows(rows || N.activityRows(state.classification.summary),state.includeCommonPipistrelle);
    rows=chart.rows;
    const total=rows.reduce((sum,row)=>sum+row.contacts,0);
    $('activities-include-pipistrelle').checked=state.includeCommonPipistrelle;
    $('activities-chart-pie').setAttribute('aria-pressed',String(state.activityChartMode==='pie'));
    $('activities-chart-bar').setAttribute('aria-pressed',String(state.activityChartMode==='bar'));
    const excluded=state.includeCommonPipistrelle?'':` Pipistrelle commune exclue du graphique : ${num(chart.omittedContacts)} contacts. Le tableau conserve toutes les espèces.`;
    $('activities-chart-note').textContent=(total?`Parts calculées sur les ${num(total)} contacts affichés, étiquettes NoID incluses, sans les Noise ni les contacts en attente.`:'Aucun contact à afficher pour le moment.')+excluded;
    $('activities-chart').innerHTML=!total && !state.includeCommonPipistrelle?`<p class="activity-chart-empty">Aucun contact à afficher avec ce filtre.${chart.omittedContacts?' Cochez la Pipistrelle commune pour afficher ses contacts.':''}</p>`:V.render(rows,state.activityChartMode);
    $('activities-image-export').disabled=!total || exportingImage;
  }
  async function exportActivityImage() {
    if(exportingImage || !state.classification)return;
    const chart=N.chartRows(N.activityRows(state.classification.summary),state.includeCommonPipistrelle);
    const rows=chart.rows;
    if(!rows.length)return;
    const mode=state.activityChartMode,format=$('activities-image-format').value;
    const excludedCommonPipistrelle=state.includeCommonPipistrelle?undefined:chart.omittedContacts;
    exportingImage=true;$('activities-image-export').disabled=true;$('activities-image-status').textContent='Préparation de l’image…';
    try {
      const result=await E.exportBlob(rows,mode,format,{ignoredNoise:state.classification.metrics.ignored,totalContacts:state.classification.metrics.total,pendingContacts:state.classification.metrics.pending,provisional:state.classification.metrics.pending>0,excludedCommonPipistrelle});
      download(`activites_chiropteres_${mode==='bar'?'barres':'camembert'}${excludedCommonPipistrelle==null?'':'_sans_pipistrelle_commune'}.${result.extension}`,result.blob,result.mimeType);
      $('activities-image-status').textContent='Image téléchargée avec les noms, les effectifs et la légende.';
    }catch(error){$('activities-image-status').textContent=error.message;toast(error.message);}
    finally{exportingImage=false;renderActivityChart();}
  }
  const speciesGroup = key => state.classification.groups.find(group=>group.key===key);
  function setSelection(key, value) {
    const candidate={...state.selections,[key]:value};
    try{A.classify(state.data,state.reviews,state.policy,state.drafts,candidate);state.selections=candidate;render();persist();}
    catch(error){toast(error.message);}
  }
  function targetPercent(g) {
    // Exact saved/adapted contact targets remain exact if their displayed rate is reapplied.
    return g.explicitTarget?String(Number((100*g.sampleTarget/g.total).toFixed(6))):String(g.samplePercent);
  }
  function targetCount(g, percent) {
    if(g.explicitTarget && percent===Number(targetPercent(g)))return g.sampleTarget;
    return Math.min(g.total,Math.max(1,Math.ceil(g.total*percent/100)));
  }
  function updateTargetPreview(input) {
    const g=speciesGroup(input.dataset.targetPercent);const percent=input.value.trim()===''?NaN:Number(input.value);
    const valid=Number.isFinite(percent) && percent>=0 && percent<=100 && !input.validity.badInput;
    const count=[...$('species-workflow').querySelectorAll('[data-target-count]')].find(span=>span.dataset.targetCount===g.key);
    input.setAttribute('aria-invalid',String(!valid));
    if(count)count.textContent=valid?`Soit ${num(targetCount(g,percent))} contact(s)${percent===0?' minimum : référence obligatoire':' · référence comprise'}.`:'Saisissez un pourcentage entre 0 et 100.';
    return valid?percent:null;
  }
  function applyTargetPercent(input) {
    if(!input)return;
    const percent=updateTargetPreview(input);if(percent==null){toast('L’objectif doit être un pourcentage entre 0 et 100 ; les décimales sont acceptées.');input.focus();return;}
    const g=speciesGroup(input.dataset.targetPercent);
    if(g.explicitTarget && percent===Number(targetPercent(g))){toast(`Objectif conservé : ${num(g.sampleTarget)} contact(s), référence comprise.`);return;}
    const previous=state.selections[g.key];
    const override=previous && !Array.isArray(previous)?{...previous}:{};
    delete override.sampleTarget;override.samplePercent=percent;
    if(g.customSelection)override.selectedIds=[...g.selectedIds];
    setSelection(g.key,override);
  }
  function renderSpeciesWorkflow() {
    if(!state.classification)return;
    const groups=state.classification.groups.filter(g=>g.kind==='species');
    $('species-workflow').innerHTML=groups.map(g=>{
      const selected=g.selectedIds || [];const anchor=state.rowById.get(g.anchorId);
      const title=g.mode==='reference'?'1 · Vérifier le meilleur contact':g.mode==='autoid'?'2 · Auto-ID validé pour l’espèce':g.canInfer?'3 · Répartition au prorata disponible':'2 · Compléter l’échantillon';
      const distribution=(g.distribution || []).map(d=>`${esc(outcomeLabel(d.label))} : ${num(d.manualCount)} manuel(s), ${ratio(d.share)} → ${num(d.inferredCount)} attribution(s)`).join('<br>');
      const target=g.sampleTarget;const manual=g.manualCount;const deficit=Math.max(0,target-manual);
      const strata=g.strata || [];
      return `<article class="species-card ${g.mode==='autoid' || g.canInfer?'complete':''}"><div class="species-card-title"><h3>${esc(g.autoId)}</h3><span>${num(g.total)} contacts</span></div><div class="species-card-state">${title}</div><div class="species-card-note">${num(g.ratioAboveThresholdCount)} / ${num(g.total)} contacts avec un rapport > 0,6 (${ratio(g.ratioAboveThresholdShare)}) · majorité ${g.majorityPass?'atteinte':'non atteinte'}<br>${g.excluded?'Espèce dans la liste d’exclusion : échantillon requis.':'Espèce hors liste d’exclusion.'}<br>Référence ${g.referenceMatches?'confirmée conforme':g.mode==='reference'?'à vérifier':'différente ou incertaine'}${anchor?' · '+esc(anchor.file):''}</div><div class="species-card-counts">${num(manual)} manuel(s) · ${num(g.inferredCount)} semi-manuel(s) · ${num(g.requiredCount)} à vérifier</div><div class="species-card-actions"><button data-workflow="${esc(g.key)}">${g.requiredCount?'Vérifier cette espèce':'Afficher tous les contacts'}</button>${g.mode!=='autoid'?`<label class="species-target-field">Objectif manuel (% des contacts)<input data-target-percent="${esc(g.key)}" type="number" min="0" max="100" step="any" value="${targetPercent(g)}" aria-label="Objectif manuel pour ${esc(g.autoId)}, en pourcentage des contacts"><span data-target-count="${esc(g.key)}" class="species-target-preview" aria-live="polite">Soit ${num(target)} contact(s) · référence comprise.</span></label><button data-apply-target="${esc(g.key)}">Appliquer l’objectif</button><button data-adapt="${esc(g.key)}">Adapter l’objectif à ma sélection (${selected.length})</button><button data-reset-sample="${esc(g.key)}">Reprendre la sélection proposée</button>`:''}</div>${g.mode!=='autoid'?`<p class="species-card-note">${selected.length} contacts sélectionnés, référence comprise · objectif ${g.explicitTarget?ratio(target/g.total):num(g.samplePercent)+' %'} des ${num(g.total)} contacts, soit ${num(target)} contrôle(s)${g.explicitTarget?' (objectif adapté ou enregistré en contacts)':' (arrondi au supérieur, minimum 1)'}${deficit?' · encore '+num(deficit)+' décision(s) pour atteindre l’objectif':''}. Vous pouvez remplacer, ajouter ou retirer des contacts depuis leur fiche. Toute vérification supplémentaire contribue au prorata.</p>`:''}${strata.length?`<details class="species-card-note"><summary>Classes de rapport et échantillon</summary><div class="species-strata-scroll" tabindex="0" aria-label="Classes de MATCH RATIO pour ${esc(g.autoId)}"><table class="species-strata-table"><colgroup><col style="width:40%"><col style="width:20%"><col style="width:20%"><col style="width:20%"></colgroup><thead><tr><th scope="col">Rapport</th><th scope="col">Contacts</th><th scope="col">Sélection</th><th scope="col">Manuels</th></tr></thead><tbody>${strata.map(s=>`<tr><td>${esc(s.label)}</td><td>${s.total}</td><td>${s.selectedCount}</td><td>${s.manualCount}</td></tr>`).join('')}</tbody></table></div></details>`:''}${distribution?`<details class="species-card-note" ${g.canInfer && g.mode==='proportion'?'open':''}><summary>Résultats manuels et répartition estimée</summary><p>${distribution}</p></details>`:''}</article>`;
    }).join('') || '<p>Aucune suggestion d’espèce : les contacts restent à identifier manuellement.</p>';
    $('species-workflow').querySelectorAll('[data-workflow]').forEach(button=>button.onclick=()=>{state.species=button.dataset.workflow;const g=speciesGroup(state.species);state.tab=g.requiredCount?'pending':'all';state.search='';$('search').value='';filterChanged();});
    $('species-workflow').querySelectorAll('[data-target-percent]').forEach(input=>{input.oninput=()=>updateTargetPreview(input);input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();applyTargetPercent(input);}};});
    $('species-workflow').querySelectorAll('[data-apply-target]').forEach(button=>button.onclick=()=>{const input=[...$('species-workflow').querySelectorAll('[data-target-percent]')].find(i=>i.dataset.targetPercent===button.dataset.applyTarget);applyTargetPercent(input);});
    $('species-workflow').querySelectorAll('[data-adapt]').forEach(button=>button.onclick=()=>{const g=speciesGroup(button.dataset.adapt);setSelection(g.key,{selectedIds:[...g.selectedIds],sampleTarget:g.selectedIds.length});toast('Objectif adapté à votre sélection. La référence reste incluse.');});
    $('species-workflow').querySelectorAll('[data-reset-sample]').forEach(button=>button.onclick=()=>{delete state.selections[button.dataset.resetSample];render();persist();toast('Sélection représentative et objectif par défaut rétablis pour cette espèce.');});
  }
  function renderQueue() {
    const rows=visibleRows(); const pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE)); state.page=Math.min(state.page,pages-1);
    $('queue-count').textContent=`${rows.length.toLocaleString('fr-BE')} contacts${state.species?' · '+speciesGroup(state.species)?.autoId:''}`;
    $('page-label').textContent=rows.length?`${state.page*PAGE_SIZE+1}–${Math.min((state.page+1)*PAGE_SIZE,rows.length)} sur ${rows.length.toLocaleString('fr-BE')}`:'Aucun contact pour ce filtre';
    $('prev-page').disabled=state.page===0; $('next-page').disabled=state.page>=pages-1;
    $('queue-body').innerHTML=rows.slice(state.page*PAGE_SIZE,(state.page+1)*PAGE_SIZE).map(r=>{const a=assignment(r);return `<tr class="${state.selected===r.id?'selected':''}" data-row="${r.id}"><td><button class="contact-button" data-select="${r.id}" title="${esc(r.file)}">${esc(r.file)}</button><div class="row-meta">${esc(autoLabel(r))} ${a.role==='reference'?'<span class="pick-dot">RÉFÉRENCE</span>':a.role==='audit'?'<span class="pick-dot audit">CONTRÔLE</span>':''}${r.issues.length?'<span title="Données à examiner">⚑</span>':''}</div><div class="row-sub">Ligne ${r.index+1} · ${esc(r.night || 'date manquante')} · canal ${esc(r.channel || '—')} · décalage ${esc(r.offset || '0')} s</div></td><td>${num(r.matching)}</td><td title="Impulsions concordantes / impulsions ; ce rapport ne mesure pas la certitude de l’identification">${ratio(r.ratio)}</td><td><span class="badge ${esc(a.status)}">${esc(statusLabel(a))}</span>${a.label && a.origin!=='pending'?`<div class="row-sub">${esc(outcomeLabel(a.label))}</div>`:''}${state.drafts[r.id]?'<div class="row-sub">Brouillon</div>':''}</td></tr>`;}).join('') || '<tr><td colspan="4"><div class="empty-state">Aucun contact ici. Choisissez un autre filtre pour continuer.</div></td></tr>';
  }
  function locator(row) {
    try{return K.recordingPath(row);}catch{}
    const indir=state.data.columns.indir>=0?row.raw[state.data.columns.indir]:'';
    const folder=row.rawFolder || '';
    const separator=indir.includes('/') && !indir.includes('\\')?'/':'\\';
    const parts=[indir,folder,row.file].filter(Boolean);
    // Preserve leading UNC \\server and never duplicate the display fallback folder.
    return parts.map((part,i)=>i===0?part.replace(/[\\/]+$/,''):part.replace(/^[\\/]+|[\\/]+$/g,'')).join(separator);
  }
  function draft(row) {
    if(state.drafts[row.id]) return {...state.drafts[row.id],reviewer:state.reviewer};
    const rev=review(row);return {status:checked(rev.status)?rev.status:'',label:rev.label,notes:rev.notes,reviewer:state.reviewer};
  }
  function updateDetailClassification() {
    const row=state.rowById.get(state.selected);const badge=$('detail').querySelector('.detail-top .badge');
    if(!row || !badge)return;const a=assignment(row);
    badge.className='badge '+a.status;badge.textContent=statusLabel(a);
    $('detail').querySelector('.suggestion > span').textContent=a.origin==='inferred'?'Attribué selon les règles actuelles':a.origin==='manual'?'Résultat manuel : '+outcomeLabel(a.label):a.origin==='ignored'?'Noise ignoré selon les règles':'Résultat du classificateur';
    let callout=$('detail').querySelector('.classification-callout');
    if(!callout){callout=document.createElement('div');$('detail').prepend(callout);}
    callout.className='classification-callout '+(a.groupBlocked?'blocked':a.origin==='inferred'?'inferred':'');
    callout.innerHTML=`<b>${a.origin==='inferred'?'Attribution par les règles : '+esc(outcomeLabel(a.label)):a.requiresReview?'Vérification manuelle obligatoire':a.origin==='manual'?'Résultat manuel : '+esc(outcomeLabel(a.label)):a.origin==='ignored'?'Contact Noise ignoré':'En attente des contrôles du groupe'}</b><span>${esc(a.reason || a.reasons.join(' · '))}</span>`;
    if($('semi-label'))$('semi-label').textContent=a.semimanualLabel || 'Vide';
  }
  function renderDetail() {
    const row=state.rowById.get(state.selected);
    $('detail').classList.remove('needs-manual-label');
    if(!row){$('detail').innerHTML='<div class="empty-state">Sélectionnez un contact à vérifier.</div>';return;}
    const rev=review(row); const d=draft(row);const a=assignment(row);const g=speciesGroup(a.groupKey);
    $('detail').classList.toggle('needs-manual-label',['corrected','uncertain'].includes(d.status));
    const options=state.labelOptions;
    const issues=row.issues.map(i=>typeof i==='string'?i:JSON.stringify(i));
    const alternate=[row.alternate1,row.alternate2].filter(Boolean);
    $('detail').innerHTML=`<div class="detail-top"><span class="eyebrow">CONTACT ${row.index+1} · RANG POUR CET AUTO-ID ${a.rank}</span><span class="badge ${esc(rev.status)}">${esc(rev.status==='unreviewed'?'À vérifier':rev.status)}</span></div><h2 class="detail-file">${esc(row.file)}</h2><div class="locator">${esc(row.folder || '(dossier source)')}<br>${esc(row.date || 'Date manquante')} ${esc(row.time || '')} · canal ${esc(row.channel || '—')} · décalage ${esc(row.offset || '0')} s</div><div class="locator-actions"><button id="copy-locator">Copier les coordonnées du fichier ↗</button><button id="inspect-guide">Comment vérifier</button></div>${a.isAnchor?'<div class="detail-callout">Meilleur contact pour cette espèce AUTO-ID sur l’ensemble du CSV. Sa décision détermine la validation directe ou le passage à un échantillon manuel.</div>':''}${alternate.length?`<div class="detail-callout warning">Suggestions alternatives : ${alternate.map(esc).join(', ')}. Vérifiez une éventuelle ambiguïté ou la présence de plusieurs chauves-souris.</div>`:''}${issues.length?`<div class="detail-callout warning">${issues.map(esc).join('<br>')}</div>`:''}<div class="metrics"><div><strong>${num(row.matching)}</strong><small>Impulsions concordantes</small></div><div><strong>${num(row.pulses)}</strong><small>Impulsions</small></div><div><strong>${ratio(row.ratio)}</strong><small>Rapport de concordance${row.ratioSource==='derived'?' (calculé)':''}</small></div><div><strong>${num(row.margin)}</strong><small>Marge</small></div></div><div class="suggestion"><div><span class="label">SUGGESTION AUTOMATIQUE</span><strong>${esc(autoLabel(row))}</strong></div><span>Espèce encore non vérifiée</span></div><div class="form-heading">Votre décision manuelle</div><div class="decision-grid"><button type="button" data-decision="confirmed" class="${d.status==='confirmed'?'chosen':''}" ${row.kind!=='species'?'disabled':''}>✓ Confirmer la suggestion</button><button type="button" data-decision="corrected" class="${d.status==='corrected'?'chosen':''}">↗ Attribuer une étiquette</button><button type="button" data-decision="uncertain" class="${d.status==='uncertain'?'chosen':''}">? Identification incertaine</button><button type="button" data-decision="noise" class="${d.status==='noise'?'chosen':''}">∅ Bruit / aucun cri de chauve-souris</button></div><label class="field-label" for="manual-label">Étiquette manuelle · espèce, groupe ou identification non résolue</label><input id="manual-label" list="species-options" value="${esc(d.label)}" placeholder="Choisissez une décision, puis saisissez une étiquette" ${['confirmed','noise'].includes(d.status)?'readonly':''}><datalist id="species-options">${options.map(o=>`<option value="${esc(o)}"></option>`).join('')}</datalist><div class="form-row"><label><span class="field-label">Vérificateur par défaut</span><input id="reviewer" value="${esc(d.reviewer)}" placeholder="Nom / initiales"><small class="reviewer-default-note">Nom mémorisé pour les prochains contacts.</small></label></div><details class="contact-extra" ${!state.minimal || d.notes ? 'open' : ''}><summary>Notes de vérification</summary><textarea id="notes" aria-label="Notes de vérification" placeholder="Forme des cris, ambiguïté, autres espèces…">${esc(d.notes)}</textarea></details><p class="draft-note">Enregistrez uniquement après avoir examiné ce contact dans ${esc(K.viewerInfo(wavViewer).name)}. « Identification incertaine » conserve une identification non résolue.</p><button class="primary detail-save" id="save-decision">Enregistrer${state.minimal || state.autoNext?' et suivant':''}</button><div class="detail-options"><label><input id="auto-next" type="checkbox" ${state.autoNext?'checked':''}>Passer au suivant après enregistrement</label><button class="text-button" id="undo" ${state.undo.length?'':'disabled'}>Annuler le dernier enregistrement</button><button class="text-button" id="reset-decision">Remettre à vérifier</button></div>${state.drafts[row.id]?'<p class="unsaved">Brouillon enregistré localement · décision non validée</p>':''}${rev.timestamp?`<p class="draft-note">Enregistré le ${esc(new Date(rev.timestamp).toLocaleString('fr-BE'))}${rev.reviewer?' · '+esc(rev.reviewer):''}</p>`:''}<details class="raw-fields"><summary>Tous les champs CSV d’origine (${state.parsed.headers.length})</summary><dl>${state.parsed.headers.map((h,i)=>`<dt>${esc(h)}</dt><dd>${esc(row.raw[i]) || '—'}</dd>`).join('')}</dl></details>`;
    const noidChoice=document.createElement('div');noidChoice.className='unidentified-choice';
    noidChoice.innerHTML=`<label for="unidentified-label">Étiquettes NoID</label><select id="unidentified-label" aria-describedby="unidentified-label-note"><option value="">Choisir une étiquette…</option>${N.IDENTIFICATION_LABELS.map(item=>`<option value="${esc(item.label)}">${esc(item.label)} · ${esc(item.description)}</option>`).join('')}</select><small id="unidentified-label-note">Ces cinq étiquettes sont comptées dans les tableaux et graphiques.</small>`;
    $('detail').querySelector('.decision-grid').after(noidChoice);
    const name=N.resolve(d.label);
    if(name.category==='unidentified')$('unidentified-label').value=name.scientificName;
    $('unidentified-label').onchange=()=>{
      const label=$('unidentified-label').value;if(!label)return;
      captureDraft();Object.assign(state.drafts[row.id],{status:'corrected',label});
      renderDetail();schedulePersist();
    };
    const viewer=K.viewerInfo(wavViewer);
    const fileButton=document.createElement('button');fileButton.id='open-recording';fileButton.type='button';fileButton.className='file-open-button';fileButton.textContent=row.file;fileButton.title='Ouvrir ce WAV dans '+viewer.name;fileButton.setAttribute('aria-label','Ouvrir '+row.file+' dans '+viewer.name);fileButton.disabled=openingRecording;fileButton.onclick=()=>openRecording(row);
    $('detail').querySelector('.detail-file').replaceChildren(fileButton);
    if(state.minimal){const contactReason=document.createElement('p');contactReason.id='review-contact-reason';contactReason.className='review-contact-reason';contactReason.textContent=P.explain(g,state.reviewPlan.groups.find(item=>item.key===g.key),a).contactReason;$('detail').querySelector('.locator-actions').after(contactReason);}
    updateDetailClassification();
    const sampleControl=document.createElement('div');sampleControl.className='sample-control';
    sampleControl.innerHTML=`<p><b>SEMIMANUAL ID :</b> <span id="semi-label">${esc(a.semimanualLabel || 'Vide')}</span></p>${a.origin==='manual'?'<p>Le résultat final conserve votre MANUAL ID en priorité.</p>':''}${g?.kind==='species' && g.mode!=='autoid'?`<label><input id="sample-toggle" type="checkbox" ${g.selectedIds.includes(row.id)?'checked':''} ${a.isAnchor?'disabled':''}>Inclure ce contact dans mon échantillon</label><p>${g.selectedIds.length} sélectionnés · objectif ${g.sampleTarget}. La référence est obligatoire. Pour vérifier moins de contacts, retirez-les puis adaptez l’objectif dans le parcours par espèce.</p>`:''}`;
    $('detail').querySelector('.classification-callout').after(sampleControl);
    if($('sample-toggle'))$('sample-toggle').onchange=()=>{const ids=new Set(g.selectedIds);if($('sample-toggle').checked)ids.add(row.id);else ids.delete(row.id);setSelection(g.key,{selectedIds:[...ids],...(g.explicitTarget?{sampleTarget:g.sampleTarget}:{samplePercent:g.samplePercent})});};
    $('copy-locator').onclick=async()=>{const value=`${locator(row)}\nLigne de données CSV : ${row.index+1}\nCanal : ${row.channel || '(manquant)'}\nDécalage : ${row.offset || '0'} s`;
      try{await navigator.clipboard.writeText(value);toast('Chemin du fichier, ligne CSV, canal et décalage copiés.');}catch{const input=document.createElement('textarea');input.value=value;document.body.append(input);input.select();const copied=document.execCommand('copy');input.remove();toast(copied?'Coordonnées du fichier copiées.':'Presse-papiers indisponible. Consultez les coordonnées et les champs d’origine ci-dessus.');}};
    $('inspect-guide').onclick=()=>{toast(viewer.id==='kaleidoscope'?'Dans Kaleidoscope : File → Open Results… → votre CSV d’origine. Retrouvez ce fichier avec le même canal et décalage, puis examinez le spectrogramme et la vue par passage à zéro.':'Dans ChiroSurf, ouvrez ce WAV puis retrouvez le canal et le décalage indiqués dans la fiche. Examinez le sonagramme, l’écoute et les mesures avant de confirmer ou corriger l’identification.');};
    document.querySelectorAll('[data-decision]').forEach(b=>b.onclick=()=>{
      captureDraft(); const selected=state.drafts[row.id];selected.status=b.dataset.decision;
      if(selected.status==='confirmed') selected.label=row.autoId;
      else if(selected.status==='noise') selected.label='Noise';
      else if(selected.status==='uncertain') selected.label='Chauve-souris non identifiée';
      else if(['Noise','NoID','Unidentified bat','Chauve-souris non identifiée',row.autoId].includes(selected.label)) selected.label='';
      renderDetail();schedulePersist();
      if(['corrected','uncertain'].includes(selected.status)) $('manual-label').focus();
    });
    ['manual-label','notes','reviewer'].forEach(id=>$(id).addEventListener('input',()=>{if(id==='reviewer')setReviewerDefault($('reviewer').value);captureDraft();schedulePersist();}));
    $('auto-next').onchange=()=>{state.autoNext=$('auto-next').checked;$('save-decision').textContent='Enregistrer'+(state.autoNext?' et suivant':'');};
    $('save-decision').onclick=saveDecision; $('undo').onclick=undo;
    if(state.minimal && row.kind==='species') {
      const bulk=document.createElement('div');bulk.className='minimal-bulk-confirmation';
      bulk.innerHTML=`<button type="button" id="confirm-species-all">Confirmer tous les contacts pour cette espèce</button><p>${num(g.total)} contacts · ${esc(g.autoId)}. Confirme l’AUTO-ID sur toutes les lignes de ce groupe, y compris les décisions existantes.</p>`;
      $('save-decision').after(bulk);
      $('confirm-species-all').onclick=confirmSpecies;
    }
    $('reset-decision').textContent=row.manualId?'Restaurer le MANUAL ID source':'Retirer ma décision';
    $('reset-decision').onclick=()=>{state.undo.push({id:row.id,previous:state.reviews[row.id] || null});delete state.reviews[row.id];delete state.drafts[row.id];render();persist();toast(row.manualId?'Décision locale retirée ; le MANUAL ID source redevient la décision manuelle active.':'Décision retirée. La procédure de cette espèce a été recalculée.');};
  }
  function captureDraft() {
    const row=state.rowById.get(state.selected);if(!row || !$('manual-label')) return;
    const existing=draft(row);
    state.drafts[row.id]={status:existing.status,label:$('manual-label').value,notes:$('notes').value,reviewer:state.reviewer};
  }
  function saveDecision() {
    const row=state.rowById.get(state.selected);if(!row || !$('manual-label')) return;
    captureDraft();const d=state.drafts[row.id];
    if(!checked(d.status)){toast('Choisissez une décision manuelle avant d’enregistrer.');return;}
    if(!d.label.trim()){toast('Saisissez une espèce, un groupe ou une étiquette non résolue.');$('manual-label').focus();return;}
    if(d.status==='confirmed' && row.kind!=='species'){toast('Ce contact ne possède aucune suggestion d’espèce à confirmer. Attribuez-lui une étiquette.');return;}
    state.undo.push({id:row.id,previous:state.reviews[row.id] || null});
    state.reviews[row.id]={...d,label:d.status==='confirmed'?row.autoId:d.status==='noise'?'Noise':d.label.trim(),timestamp:new Date().toISOString()};delete state.drafts[row.id];
    recalculate();const next=visibleRows().find(r=>assignment(r).requiresReview);
    if((state.minimal || state.autoNext) && next) {state.selected=next.id;const remaining=visibleRows();state.page=Math.floor(Math.max(0,remaining.findIndex(r=>r.id===next.id))/PAGE_SIZE);}
    render();persist();toast(d.status==='uncertain'?'Identification incertaine enregistrée. Elle contribue à la part non résolue du prorata.':'Décision enregistrée. Les totaux et les vérifications restantes ont été recalculés.');
  }
  function confirmSpecies() {
    const row=state.rowById.get(state.selected);
    if(!state.minimal || !row || row.kind!=='species' || !$('confirm-species-all'))return;
    const group=speciesGroup(assignment(row).groupKey);
    const result=B.apply({rows:state.data.rows,reviews:state.reviews,drafts:state.drafts,groupKey:group.key,reviewer:state.reviewer,timestamp:new Date().toISOString()});
    clearTimeout(saveTimer);
    state.undo.push({id:row.id,changes:result.changes});
    state.reviews=result.reviews;state.drafts=result.drafts;
    recalculate();const next=visibleRows().find(r=>assignment(r).requiresReview);
    if(next)state.selected=next.id;
    render();persist();
    toast(`${num(result.changes.length)} contacts confirmés pour ${outcomeLabel(group.autoId)}. Vous pouvez annuler cette confirmation globale.`);
  }
  function undo() {
    const item=state.undo.pop();if(!item)return;
    clearTimeout(saveTimer);
    const restored=B.restore({reviews:state.reviews,drafts:state.drafts,changes:item.changes || [{id:item.id,previous:item.previous,previousDraft:null}]});
    state.reviews=restored.reviews;state.drafts=restored.drafts;state.selected=item.id;
    render();persist();toast(item.changes?'Confirmation globale annulée ; décisions et brouillons précédents restaurés.':'Dernier enregistrement annulé.');
  }
  function selectRow(id) {state.selected=id;renderQueue();renderDetail();}
  function filterChanged() {state.page=0;const rows=visibleRows();if(!rows.some(r=>r.id===state.selected)) state.selected=rows[0]?.id || null;render();}
  const sidecarHeaders=['SOURCE ROW','INDIR','FOLDER','IN FILE','CHANNEL','OFFSET','DATE','TIME','NIGHT','AUTO ID','ORIGINAL MANUAL ID','REVIEW STATUS','REVIEW LABEL','REVIEWER','REVIEWED AT','NOTES','GROUP RANK','REFERENCE PICK','MATCHING','PULSES','MATCH RATIO','MARGIN','DATA ISSUES','ASSIGNED LABEL','ASSIGNMENT ORIGIN','ASSIGNMENT STATUS','REQUIRED MANUAL CHECK','CHECK ROLE','ASSIGNMENT REASON','CLASSIFICATION POLICY','SEMIMANUAL ID','SEMIMANUAL METHOD','GLOBAL GROUP','SAMPLE SELECTED','SAMPLE TARGET'];
  function sidecarRecord(row) {const rev=review(row);const a=assignment(row);const g=speciesGroup(a.groupKey);return [row.index+1,state.data.columns.indir>=0?row.raw[state.data.columns.indir]:'',row.rawFolder || '',row.file,row.channel,row.offset,row.date,row.time,row.night,row.autoId,row.manualId,rev.status,rev.label,rev.reviewer,rev.timestamp,rev.notes,a.rank,a.isAnchor?'yes':'no',row.matching??'',row.pulses??'',row.ratio??'',row.margin??'',row.issues.join(' | '),a.label,a.origin,a.status,a.requiresReview?'yes':'no',a.role,a.reason || a.reasons.join(' | '),JSON.stringify(state.policy),a.semimanualLabel,a.semimanualMethod,a.groupKey,g.selectedIds.includes(row.id)?'yes':'no',g.sampleTarget];}
  // Spreadsheet-safe text in sidecars; source CSV values must remain unchanged.
  const safe = value => /^[\t\r\n ]*[=+@-]/.test(String(value)) ? "'"+value : value;
  function exportSidecar(pending=false) {recalculate();const rows=pending?state.data.rows.filter(r=>assignment(r).requiresReview):state.data.rows;download(baseName()+(pending?'-verifications-obligatoires.csv':'-journal-verification.csv'),'\ufeff'+C.stringifyCSV(sidecarHeaders,rows.map(r=>sidecarRecord(r).map(safe)),','),'text/csv;charset=utf-8');}
  function exportSummary() {
    if(!state.data)return;recalculate();const c=state.classification;const complete=c.metrics.required===0 && c.metrics.waiting===0;
    const headers=['LIBELLÉ','CATÉGORIE','CONTACTS VÉRIFIÉS MANUELLEMENT','CONTACTS ATTRIBUÉS PAR LES RÈGLES','CONTACTS IGNORÉS','TOTAL DES CONTACTS','FICHIER SOURCE','VÉRIFICATIONS TERMINÉES','RÈGLES','DATE DE GÉNÉRATION'];
    const categories={taxon:'taxon',noise:'bruit',uncertain:'incertain',unresolved:'non résolu',pending:'en attente'};
    const time=new Date().toISOString();const records=c.summary.map(s=>[outcomeLabel(s.label),categories[s.category],s.manual,s.inferred,s.ignored,s.total,state.source.name,complete?'oui':'non',JSON.stringify(state.policy),time].map(safe));
    download(baseName()+'-synthese-especes.csv','\ufeff'+C.stringifyCSV(headers,records,','),'text/csv;charset=utf-8');
  }
  function exportActivities() {
    if(!state.data)return;recalculate();renderActivities();
    if(state.classification.metrics.pending){toast('Terminez les contrôles avant d’exporter le tableau final des activités.');return;}
    const headers=['Nom scientifique','Nom vernaculaire','Nombre de contacts'];
    const records=N.activityRows(state.classification.summary).map(row=>[row.scientificName,row.frenchName,row.contacts].map(safe));
    download('activites_chiropteres.csv','\ufeff'+C.stringifyCSV(headers,records,';'),'text/csv;charset=utf-8');
  }
  function exportClassified() {
    recalculate();const metadata=['PLECOTUS SOURCE ROW','PLECOTUS ASSIGNED LABEL','PLECOTUS ORIGIN','PLECOTUS STATUS','PLECOTUS CHECK REQUIRED','PLECOTUS CHECK ROLE','PLECOTUS REASON','PLECOTUS POLICY','PLECOTUS SEMIMANUAL ID','PLECOTUS SEMIMANUAL METHOD','PLECOTUS GLOBAL GROUP','PLECOTUS SAMPLE SELECTED','PLECOTUS SAMPLE TARGET'];
    const headers=[...state.parsed.headers];metadata.forEach(name=>{let unique=name;while(headers.some(h=>h.toUpperCase()===unique.toUpperCase()))unique+=' (new)';headers.push(unique);});
    const records=state.data.rows.map(row=>{const a=assignment(row);const g=speciesGroup(a.groupKey);return [...row.raw,...[row.index+1,a.label,a.origin,a.status,a.requiresReview?'yes':'no',a.role,a.reason || a.reasons.join(' | '),JSON.stringify(state.policy),a.semimanualLabel,a.semimanualMethod,a.groupKey,g.selectedIds.includes(row.id)?'yes':'no',g.sampleTarget].map(safe)];});
    download(baseName()+'-contacts-classes.csv','\ufeff'+C.stringifyCSV(headers,records,state.parsed.delimiter),'text/csv;charset=utf-8');
  }
  function putPolicyInForm(policy) {
    $('policy-sample').value=policy.samplePercent;
    $('policy-ignore-noise').checked=policy.ignoreNoise;
  }
  function readPolicyForm() {
    return A.normalizePolicy({version:2,samplePercent:Number($('policy-sample').value),ignoreNoise:$('policy-ignore-noise').checked});
  }
  function previewPolicy() {
    if(!$('rules-form').checkValidity()){$('policy-preview').textContent='Saisissez des valeurs valides pour afficher l’effet de ces règles.';return;}
    try{const policy=readPolicyForm();if(!state.data){$('policy-preview').textContent='Ces règles seront utilisées à l’import. Les objectifs individuels explicites restent prioritaires.';return;}const m=A.classify(state.data,state.reviews,policy,state.drafts,state.selections).metrics;$('policy-preview').textContent=`${m.required} vérifications restantes · ${m.waiting} contacts en attente · ${m.inferred} semi-manuels · ${m.manual} manuels · ${m.ignored} Noise ignorés. Les objectifs individuels explicites restent prioritaires.`;}catch(e){$('policy-preview').textContent=e.message;}
  }
  function exportID() {
    const headers=[...state.parsed.headers];let col=state.data.columns.manualId;if(col<0){col=headers.length;headers.push('MANUAL ID');}
    const records=state.data.rows.map(row=>{const raw=[...row.raw];while(raw.length<headers.length)raw.push('');const rev=review(row);if(checked(rev.status))raw[col]=rev.label;return raw;});
    download(baseName()+'-etiquettes-manuelles.csv','\ufeff'+C.stringifyCSV(headers,records,state.parsed.delimiter),'text/csv;charset=utf-8');toast('CSV des étiquettes manuelles exporté. Conservez l’original et vérifiez cette copie dans Kaleidoscope.');
  }
  function exportSemimanual() {
    recalculate();const headers=[...state.parsed.headers];let manualCol=state.data.columns.manualId;
    if(manualCol<0){manualCol=headers.length;headers.push('MANUAL ID');}
    let semiCol=headers.findIndex(h=>h.toUpperCase().replace(/[^A-Z0-9]/g,'')==='SEMIMANUALID');
    if(semiCol<0){semiCol=headers.length;headers.push('SEMIMANUAL ID');}
    const records=state.data.rows.map(row=>{const raw=[...row.raw];while(raw.length<headers.length)raw.push('');const rev=review(row);if(checked(rev.status))raw[manualCol]=rev.label;raw[semiCol]=assignment(row).semimanualLabel;return raw;});
    download(baseName()+'-semi-manuel.csv','\ufeff'+C.stringifyCSV(headers,records,state.parsed.delimiter),'text/csv;charset=utf-8');toast('CSV semi-manuel exporté : décisions humaines dans MANUAL ID, remplissage des règles dans SEMIMANUAL ID.');
  }
  function demo() {
    const headers=['INDIR','FOLDER','IN FILE','CHANNEL','OFFSET','DURATION','DATE','TIME','DATE-12','AUTO ID','PULSES','MATCHING','MATCH RATIO','MARGIN','ALTERNATE 1','ALTERNATE 2','MANUAL ID','Fc','Sc','Dur','Fmax','Fmin','Qual'];
    const specs=[];
    for(let i=0;i<24;i++){const p=40-i%20;specs.push(['PIPPIP',p,p-1,Number(((p-1)/p).toFixed(6)),2-i*.02,'']);}
    for(let i=0;i<10;i++){const p=18+i%5;specs.push(['PIPNAT',p,p-1,Number(((p-1)/p).toFixed(6)),1.5+i*.03,'']);}
    specs.push(['MYODAU',14,9,.642857,.8,'MYOMYS'],['MYODAU',4,2,.5,.3,''],['MYODAU',8,5,.625,.6,''],['PIPPIP',3,3,1,.5,'PIPNAT']);
    for(let i=0;i<4;i++)specs.push(['NoID',8+i,0,0,0,'']);
    for(let i=0;i<10;i++)specs.push(['Noise',0,0,'',0,'']);
    specs.push(['Noise',2,0,0,0,''],['',5,'','','','']);
    for(let i=0;i<50;i++){const r=[.1,.3,.5,.7,.9][Math.floor(i/10)];const p=i===49?200:40;specs.push(['NYCNOC',p,Math.round(p*r),r,.2,'']);}
    const records=specs.map(([id,p,m,r,margin,alt],i)=>{const hour=21+Math.floor(i/60);const minute=String(i%60).padStart(2,'0');return ['C:\\BatSurvey\\Example',i%2?'site-B':'site-A',`REC_${String(i+1).padStart(4,'0')}_20260918_${hour}${minute}00.wav`,0,0,5,'2026-09-18',`${hour}:${minute}:00`,'2026-09-18',id,p,m,r,margin,alt,'',i===35?'Myotis sp.':'',id==='PIPPIP'?45.2:'',.5,3.2,72,41,8];});
    acceptSource({name:'example-id.csv',text:C.stringifyCSV(headers,records,',')});toast('Exemple fictif chargé. Ces chiffres illustrent le fonctionnement ; ils ne proviennent pas d’enregistrements réels.');
  }
  $('upload').onclick=$('welcome-import').onclick=$('minimal-import').onclick=()=>requestOpen(()=>$('csv-file').click());
  $('csv-file').onchange=e=>loadCSV(e.target.files[0]);$('project-file').onchange=e=>loadProject(e.target.files[0]);
  $('open-project').onclick=()=>requestOpen(()=>$('project-file').click());
  $('load-demo').onclick=$('welcome-demo').onclick=()=>requestOpen(demo);
  $('save-project').onclick=saveProject;$('method').onclick=()=>$('guide-dialog').showModal();
  $('view-mode').onclick=()=>setViewMode(!state.minimal);
  $('minimal-start').onclick=()=>{state.minimalStarted=true;render();};
  $('minimal-overview-back').onclick=()=>{state.minimalStarted=false;state.resultsView=false;render();};
  $('minimal-results').onclick=()=>{
    if(state.classification.metrics.pending){setViewMode(false);$('species-workflow-panel').open=true;$('species-workflow-panel').scrollIntoView({block:'start'});return;}
    state.resultsView=true;$('activities-panel').open=true;render();
  };
  $('minimal-all').onclick=()=>{state.tab='all';state.species='';state.search='';$('search').value='';setViewMode(false);};
  $('minimal-undo').onclick=undo;
  $('reviewer-settings').onclick=()=>openSettings();
  $('stop-local-launcher').onclick=async()=>{try{const response=await fetch('/api/stop',{method:'POST',headers:{'X-Plecotus-Token':localToken}});if(!response.ok)throw new Error();localLauncher=false;$('stop-local-launcher').hidden=true;$('wav-viewer-connection').textContent='Lanceur arrêté. Vous pouvez poursuivre la classification dans cet onglet. Pour ouvrir d’autres WAV, relancez Demarrer-Plecotus.cmd puis rechargez la page.';}catch{toast('Le lanceur est indisponible ou déjà arrêté.');}};
  $('wav-viewer').onchange=()=>{
    settingsExecutables[settingsViewer]=$('wav-viewer-executable').value;
    settingsViewer=K.viewerInfo($('wav-viewer').value).id;renderViewerSettings();
    $('settings-error').hidden=true;
  };
  $('reviewer-form').onsubmit=e=>{
    e.preventDefault();settingsExecutables[settingsViewer]=$('wav-viewer-executable').value;
    const nextExecutables={};
    for(const id of ['kaleidoscope','chirosurf']){
      try{nextExecutables[id]=K.normalizeExecutable(settingsExecutables[id],id);}
      catch(error){settingsViewer=id;renderViewerSettings();$('settings-error').textContent=error.message;$('settings-error').hidden=false;$('wav-viewer-executable').focus();return;}
    }
    wavViewer=K.viewerInfo($('wav-viewer').value).id;viewerExecutables=nextExecutables;
    const stored=setReviewerDefault($('default-reviewer').value);$('reviewer-dialog').close();
    if(state.data){renderFocusedContact();persist();}if(stored)toast('Réglages mémorisés pour les prochains contacts et CSV.');
  };
  $('rules').onclick=()=>{putPolicyInForm(state.policy);previewPolicy();$('rules-dialog').showModal();};
  $('policy-sample').oninput=previewPolicy;
  $('policy-ignore-noise').onchange=previewPolicy;
  $('rules-form').onsubmit=e=>{e.preventDefault();if(!$('rules-form').reportValidity())return;try{state.policy=readPolicyForm();$('rules-dialog').close();if(state.data){recalculate();filterChanged();persist();}toast('Règles appliquées. Les décisions manuelles sont conservées ; les attributions par les règles et les vérifications obligatoires ont été recalculées.');}catch(error){toast(error.message);}};
  $('export').onclick=()=>{recalculate();const m=state.classification.metrics;const drafts=Object.keys(state.drafts).length;$('export-caption').textContent=`${m.manual} vérifiés manuellement · ${m.inferred} attribués par les règles · ${m.ignored} Noise ignorés · ${m.required} vérifications obligatoires restantes · ${m.waiting} en attente des contrôles.${drafts?' '+drafts+' brouillons non terminés ne sont pas des décisions validées.':''}`;$('export-dialog').showModal();};
  $('activities-export').onclick=$('export-activities').onclick=exportActivities;$('export-id').onclick=exportID;$('export-semimanual').onclick=exportSemimanual;$('export-audit').onclick=()=>exportSidecar();$('export-pending').onclick=()=>exportSidecar(true);$('export-summary').onclick=$('summary-export').onclick=exportSummary;$('export-classified').onclick=exportClassified;
  $('activities-image-export').onclick=exportActivityImage;
  $('activities-chart-pie').onclick=()=>{state.activityChartMode='pie';renderActivityChart();};
  $('activities-chart-bar').onclick=()=>{state.activityChartMode='bar';renderActivityChart();};
  $('activities-include-pipistrelle').onchange=()=>{state.includeCommonPipistrelle=$('activities-include-pipistrelle').checked;$('activities-image-status').textContent='';renderActivityChart();};
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  $('cancel-replace').onclick=()=>{pendingOpen=null;$('replace-dialog').close();};
  function continueOpen(backup){if(backup)saveProject();const fn=pendingOpen;pendingOpen=null;$('replace-dialog').close();fn?.();}
  $('backup-replace').onclick=()=>continueOpen(true);$('continue-replace').onclick=()=>continueOpen(false);
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;filterChanged();});
  $('species-list').onclick=e=>{const button=e.target.closest('[data-species]');if(button){state.species=button.dataset.species;filterChanged();}};
  $('all-groups').onclick=()=>{state.species='';filterChanged();};
  $('search').oninput=e=>{state.search=e.target.value;filterChanged();};$('sort').onchange=e=>{state.sort=e.target.value;filterChanged();};
  $('queue-body').onclick=e=>{const row=e.target.closest('[data-row]');if(row)selectRow(row.dataset.row);};
  $('prev-page').onclick=()=>{state.page--;renderQueue();};$('next-page').onclick=()=>{state.page++;renderQueue();};
  document.addEventListener('keydown',e=>{
    if(!state.data || document.querySelector('dialog[open]'))return;
    if(e.ctrlKey && e.key==='Enter'){e.preventDefault();saveDecision();return;}
    if(state.minimal)return;
    if(e.ctrlKey||e.altKey||e.metaKey||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;
    if(e.key.toLowerCase()==='j'||e.key.toLowerCase()==='k'){const rows=visibleRows();const at=rows.findIndex(r=>r.id===state.selected);const next=rows[at+(e.key.toLowerCase()==='j'?1:-1)];if(next){e.preventDefault();state.page=Math.floor(rows.indexOf(next)/PAGE_SIZE);selectRow(next.id);}}
  });
  window.addEventListener('pagehide',()=>{clearTimeout(saveTimer);if(state.source)persist();});
  try{const saved=localStorage.getItem(STORAGE);if(saved){const p=JSON.parse(saved);if(p.format==='plecotus-review'&&[1,2,3].includes(p.version)){acceptSource(p.source,p);toast(p.version<3?'Projet local restauré ; ancienne règle prudente remplacée, décisions conservées.':'Projet local restauré avec ses décisions et sa sélection.');}}}catch(error){$('save-status').textContent='Restauration depuis le navigateur indisponible';}
})();

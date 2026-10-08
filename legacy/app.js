(function () {
  'use strict';

  // Renseignez ces valeurs pour activer l'inscription et le paiement.
  var CONFIG = {
    signupEndpoint: '', // ex. 'https://formspree.io/f/xxxx' ou votre API
    paymentLinks: { solo: { month: '', year: '' }, famille: { month: '', year: '' } } // liens Stripe Payment Links
  };

  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  /* ---------- Aperçu produit (données d'exemple) ---------- */
  var TABS = {
    semaine: { title: 'Cette semaine', html:
      '<div class="kpis"><div class="kpi"><small>À traiter</small><strong>4</strong></div><div class="kpi"><small>Échéances à 30 jours</small><strong>7</strong></div><div class="kpi"><small>Économies repérées</small><strong>312 €</strong></div></div>' +
      task('Répondre à la mutuelle', 'avant le 14') + task('Payer la taxe foncière', 'avant le 15') + task('Résilier l\'option TV', 'préavis : 12 j') },
    docs: { title: 'Documents', html:
      task('Facture énergie — septembre', '84,20 €') + task('Avis de la CAF', 'résumé prêt') + task('Contrat assurance habitation', 'renouvellement 02/12') + task('Courrier du syndic', 'à lire') },
    abos: { title: 'Abonnements', html:
      '<div class="kpis"><div class="kpi"><small>Abonnements détectés</small><strong>11</strong></div><div class="kpi"><small>Par mois</small><strong>147 €</strong></div><div class="kpi"><small>Inutilisés</small><strong>3</strong></div></div>' +
      task('Application de streaming — peu utilisée', '12,99 €') + task('Salle de sport — hausse de 4 €', '34,00 €') },
    courriers: { title: 'Courriers', html:
      task('Lettre de résiliation — option TV', 'brouillon') + task('Contestation de frais bancaires', 'brouillon') + task('Demande de geste commercial', 'prêt à envoyer') }
  };
  function task(a, b) { return '<div class="task">' + esc(a) + '<span>' + esc(b) + '</span></div>'; }

  var dashTitle = document.getElementById('dash-title'), dashBody = document.getElementById('dash-body');
  function showTab(k) {
    dashTitle.textContent = TABS[k].title;
    dashBody.innerHTML = '<div style="display:grid;gap:12px">' + TABS[k].html + '</div>';
    document.querySelectorAll('[data-tab]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === k)); });
  }
  document.querySelectorAll('[data-tab]').forEach(function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab); }); });
  showTab('semaine');

  /* ---------- Analyse de démonstration (100 % locale) ---------- */
  var SAMPLE = 'Objet : Avis de modification tarifaire\n\nMadame, Monsieur,\n\nNous vous informons que le tarif de votre abonnement passera de 29,99 € à 35,99 € par mois à compter du 01/12/2026. Si vous refusez cette modification, vous pouvez résilier votre contrat sans frais avant le 15 novembre 2026 par courrier recommandé.\n\nCordialement,\nLe service client';
  var MONTHS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  var TYPES = [
    { re: /(facture|montant à payer|règlement)/i, label: 'Facture', action: 'Vérifier le montant et programmer le paiement.' },
    { re: /(résili|résilier|préavis|reconduction)/i, label: 'Contrat / résiliation', action: 'Décider avant la date limite ; un brouillon de résiliation peut être préparé.' },
    { re: /(tarif|augmentation|hausse|modification tarifaire)/i, label: 'Changement de tarif', action: 'Comparer l\'ancien et le nouveau prix, puis négocier ou résilier.' },
    { re: /(impôt|taxe|avis d'imposition|dgfip)/i, label: 'Impôts / taxes', action: 'Contrôler les montants et noter la date limite de paiement.' },
    { re: /(mutuelle|assurance|sinistre|remboursement)/i, label: 'Assurance / santé', action: 'Conserver le document et vérifier les remboursements attendus.' }
  ];
  function parseDates(t) {
    var out = [], m, re1 = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})\b/g,
      re2 = new RegExp('\\b(\\d{1,2})(?:er)?\\s+(' + MONTHS.join('|') + ')\\s+(\\d{4})\\b', 'gi');
    while ((m = re1.exec(t))) out.push(new Date(+m[3], +m[2] - 1, +m[1]));
    while ((m = re2.exec(t))) out.push(new Date(+m[3], MONTHS.indexOf(m[2].toLowerCase()), +m[1]));
    return out.filter(function (d) { return !isNaN(d) && d.getMonth() < 12; }).sort(function (a, b) { return a - b; });
  }
  function parseAmounts(t) {
    var out = [], m, re = /(\d{1,3}(?:[  .]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s?(?:€|eur(?:os?)?)/gi;
    while ((m = re.exec(t))) out.push({ raw: m[0].trim(), v: parseFloat(m[1].replace(/[  ]/g, '').replace(',', '.')) });
    return out;
  }
  var fmt = function (d) { return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); };

  function analyze(text) {
    var types = TYPES.filter(function (t) { return t.re.test(text); });
    var dates = parseDates(text), amounts = parseAmounts(text), now = new Date(), h = '<h3>Résultat</h3>';
    if (!types.length && !dates.length && !amounts.length) return h + '<p>Rien de précis détecté. Essayez avec un courrier contenant des dates ou des montants.</p>';
    if (types.length) h += types.map(function (t) { return '<span class="tag">' + esc(t.label) + '</span>'; }).join('');
    h += '<ul>';
    dates.forEach(function (d) {
      var days = Math.ceil((d - now) / 864e5);
      h += '<li><span>Date repérée</span><b>' + esc(fmt(d)) + (days >= 0 ? ' · dans ' + days + ' j' : ' · passée') + '</b></li>';
    });
    amounts.forEach(function (a) { h += '<li><span>Montant</span><b>' + esc(a.raw) + '</b></li>'; });
    if (amounts.length >= 2 && /(passera|passe de|augment|hausse|modification)/i.test(text)) {
      var diff = amounts[1].v - amounts[0].v;
      if (diff > 0) h += '<li><span>Hausse estimée</span><b>+' + diff.toFixed(2).replace('.', ',') + ' €/mois · ' + (diff * 12).toFixed(2).replace('.', ',') + ' €/an</b></li>';
    }
    h += '</ul>';
    if (types.length) h += '<p><b>Action conseillée :</b> ' + esc(types[0].action) + '</p>';
    return h + '<p class="note">Analyse de démonstration par règles simples ; l\'agent complet comprend le contexte du document.</p>';
  }
  var doc = document.getElementById('doc'), result = document.getElementById('result');
  document.getElementById('sample').addEventListener('click', function () { doc.value = SAMPLE; });
  document.getElementById('analyze').addEventListener('click', function () {
    var t = doc.value.trim();
    result.innerHTML = t ? analyze(t) : '<h3>Résultat</h3><p>Collez d\'abord un texte à analyser.</p>';
  });

  /* ---------- Tarifs ---------- */
  var PRICES = { solo: { month: '9,90', year: '99' }, famille: { month: '19,90', year: '199' } };
  var period = 'month';
  function setPeriod(p) {
    period = p;
    document.getElementById('bill-m').setAttribute('aria-pressed', String(p === 'month'));
    document.getElementById('bill-y').setAttribute('aria-pressed', String(p === 'year'));
    document.querySelectorAll('[data-price]').forEach(function (el) { el.textContent = PRICES[el.dataset.price][p]; });
    document.querySelectorAll('[data-per]').forEach(function (el) { el.textContent = p === 'month' ? ' /mois' : ' /an'; });
  }
  document.getElementById('bill-m').addEventListener('click', function () { setPeriod('month'); });
  document.getElementById('bill-y').addEventListener('click', function () { setPeriod('year'); });

  /* ---------- Inscription ---------- */
  var chosen = 'decouverte', label = document.getElementById('plan-label');
  var NAMES = { decouverte: 'Découverte (gratuit)', solo: 'Solo', famille: 'Famille' };
  document.querySelectorAll('[data-plan]').forEach(function (a) {
    a.addEventListener('click', function () { chosen = a.dataset.plan; label.textContent = 'Formule choisie : ' + NAMES[chosen] + '. Laissez votre email pour créer votre espace.'; });
  });
  var form = document.getElementById('signup'), msg = document.getElementById('form-msg');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = document.getElementById('email').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = 'Merci de saisir un email valide.'; return; }
    var link = chosen !== 'decouverte' && CONFIG.paymentLinks[chosen] && CONFIG.paymentLinks[chosen][period];
    var done = function () {
      if (link) { window.location.href = link + (link.indexOf('?') > -1 ? '&' : '?') + 'prefilled_email=' + encodeURIComponent(email); return; }
      msg.textContent = 'Merci ! Nous vous écrivons très vite à ' + email + '.';
      form.reset();
    };
    if (!CONFIG.signupEndpoint) { done(); return; }
    fetch(CONFIG.signupEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: email, plan: chosen, period: period }) })
      .then(function (r) { if (!r.ok) throw new Error(); done(); })
      .catch(function () { msg.textContent = 'Une erreur est survenue. Réessayez dans un instant.'; });
  });
})();

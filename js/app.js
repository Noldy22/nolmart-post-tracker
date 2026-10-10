/**
 * NOLMART POST TRACKER - CORE APPLICATION LOGIC
 * Features:
 * - 135 Verbatim Posts across 4 Documents
 * - Instant Filtering by Document, Posted/Unposted Status, Format, and Search
 * - 1-Click Clipboard Copying for Prompts and Captions
 * - Persistent State in LocalStorage with JSON Backup/Restore
 * - Offline PWA Support & Service Worker Registration
 */

(function () {
  'use strict';

  // --- STATE ---
  let postsData = [];
  let documentsMeta = [];
  let userState = {}; // { [postId]: { posted: boolean, postedAt: string, notes: string } }
  
  let currentDocFilter = 'all'; // 'all', 1, 2, 3, 4
  let currentStatusFilter = 'all'; // 'all', 'unposted', 'posted'
  let currentFormatFilter = 'all';
  let searchQuery = '';

  const STORAGE_KEY = 'nolmart_post_tracker_v1_state';

  // --- DOM ELEMENTS ---
  const postsFeedEl = document.getElementById('postsFeed');
  const searchInputEl = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const docTabsContainer = document.getElementById('docTabs');
  const statusPills = document.querySelectorAll('.status-pill');
  const formatSelectEl = document.getElementById('formatSelect');
  const progressFillEl = document.getElementById('progressFill');
  const progressNumbersEl = document.getElementById('progressNumbers');
  const progressPctEl = document.getElementById('progressPct');
  const toastNoticeEl = document.getElementById('toastNotice');
  const toastTextEl = document.getElementById('toastText');
  const filterResultsCountEl = document.getElementById('filterResultsCount');
  const scrollTopBtn = document.getElementById('scrollTopBtn');
  const installBannerEl = document.getElementById('installBanner');
  const installAppBtn = document.getElementById('installAppBtn');
  const closeInstallBannerBtn = document.getElementById('closeInstallBanner');

  // --- INITIALIZATION ---
  function init() {
    loadUserState();
    loadDataset();
    setupEventListeners();
    setupPWA();
  }

  // --- LOAD USER STATE ---
  function loadUserState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        userState = JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Could not load user state from localStorage:', e);
      userState = {};
    }
  }

  function saveUserState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(userState));
    } catch (e) {
      console.error('Error saving state:', e);
    }
    updateProgressMetrics();
  }

  // --- LOAD DATASET ---
  function loadDataset() {
    if (window.NOLMART_POSTS_DATA && window.NOLMART_POSTS_DATA.posts) {
      processData(window.NOLMART_POSTS_DATA);
    } else {
      fetch('./data/posts_data.json')
        .then(res => res.json())
        .then(data => processData(data))
        .catch(err => {
          console.error('Failed to load posts data:', err);
          postsFeedEl.innerHTML = `
            <div class="empty-state">
              <div class="empty-icon">⚠️</div>
              <div class="empty-title">Error Loading Posts Data</div>
              <p>Please ensure data/posts_data.js or data/posts_data.json is present.</p>
            </div>
          `;
        });
    }
  }

  function processData(data) {
    postsData = data.posts || [];
    documentsMeta = data.documents || [];
    renderDocTabs();
    updateProgressMetrics();
    renderFeed();
  }

  // --- RENDER DOCUMENT TABS ---
  function renderDocTabs() {
    if (!docTabsContainer) return;
    
    const totalCount = postsData.length;
    let html = `
      <button class="doc-tab active" data-doc="all">
        <span>🌟 All Documents</span>
        <span class="tab-count">${totalCount}</span>
      </button>
    `;

    documentsMeta.forEach(doc => {
      const docCount = postsData.filter(p => p.docId === doc.id).length;
      let icon = '📄';
      if (doc.id === 1) icon = '📅';
      if (doc.id === 2) icon = '🖼️';
      if (doc.id === 3) icon = '🎥';
      if (doc.id === 4) icon = '🚀';

      html += `
        <button class="doc-tab" data-doc="${doc.id}">
          <span>${icon} ${doc.shortName}</span>
          <span class="tab-count">${docCount}</span>
        </button>
      `;
    });

    docTabsContainer.innerHTML = html;

    docTabsContainer.querySelectorAll('.doc-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        docTabsContainer.querySelectorAll('.doc-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const docVal = tab.getAttribute('data-doc');
        currentDocFilter = docVal === 'all' ? 'all' : parseInt(docVal, 10);
        renderFeed();
      });
    });
  }

  // --- PROGRESS METRICS ---
  function updateProgressMetrics() {
    const total = postsData.length;
    if (total === 0) return;

    let postedCount = 0;
    postsData.forEach(p => {
      if (userState[p.id] && userState[p.id].posted) {
        postedCount++;
      }
    });

    const pct = Math.round((postedCount / total) * 100);
    if (progressFillEl) progressFillEl.style.width = `${pct}%`;
    if (progressNumbersEl) {
      progressNumbersEl.innerHTML = `<span class="progress-highlight">${postedCount}</span> of ${total} posted`;
    }
    if (progressPctEl) progressPctEl.textContent = `${pct}%`;
  }

  // --- FILTER POSTS ---
  function getFilteredPosts() {
    return postsData.filter(post => {
      // Document Filter
      if (currentDocFilter !== 'all' && post.docId !== currentDocFilter) {
        return false;
      }

      // Status Filter
      const isPosted = !!(userState[post.id] && userState[post.id].posted);
      if (currentStatusFilter === 'posted' && !isPosted) return false;
      if (currentStatusFilter === 'unposted' && isPosted) return false;

      // Format Filter
      if (currentFormatFilter !== 'all') {
        const fmt = (post.format || '').toLowerCase();
        if (currentFormatFilter === 'video' && !fmt.includes('video')) return false;
        if (currentFormatFilter === 'carousel' && !fmt.includes('carousel')) return false;
        if (currentFormatFilter === 'image' && !fmt.includes('image') && !fmt.includes('photo')) return false;
      }

      // Search Filter
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const title = (post.title || '').toLowerCase();
        const hook = (post.hook || '').toLowerCase();
        const message = (post.message || '').toLowerCase();
        const caption = (post.caption || '').toLowerCase();
        const pillar = (post.pillar || '').toLowerCase();
        const promptText = (post.prompts || []).map(p => p.text).join(' ').toLowerCase();

        const match = title.includes(q) ||
          hook.includes(q) ||
          message.includes(q) ||
          caption.includes(q) ||
          pillar.includes(q) ||
          promptText.includes(q);

        if (!match) return false;
      }

      return true;
    });
  }

  // --- RENDER POST FEED ---
  function renderFeed() {
    const filtered = getFilteredPosts();
    
    if (filterResultsCountEl) {
      const docLabel = currentDocFilter === 'all' ? 'All Sources' : `Doc ${currentDocFilter}`;
      const statusLabel = currentStatusFilter.toUpperCase();
      filterResultsCountEl.textContent = `Showing ${filtered.length} posts (${docLabel} • ${statusLabel})`;
    }

    if (filtered.length === 0) {
      postsFeedEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <div class="empty-title">No Posts Found</div>
          <p>Try switching filter tabs or clearing your search query.</p>
        </div>
      `;
      return;
    }

    let cardsHtml = '';
    filtered.forEach(post => {
      const isPosted = !!(userState[post.id] && userState[post.id].posted);
      const postedAt = userState[post.id] && userState[post.id].postedAt ? userState[post.id].postedAt : '';

      cardsHtml += renderPostCard(post, isPosted, postedAt);
    });

    postsFeedEl.innerHTML = cardsHtml;
    attachCardListeners();
  }

  // --- RENDER SINGLE POST CARD ---
  function renderPostCard(post, isPosted, postedAt) {
    const docBadgeClass = `badge-doc-${post.docId}`;
    
    // Prompts rendering
    let promptsSection = '';
    if (post.prompts && post.prompts.length > 0) {
      if (post.prompts.length === 1) {
        const p = post.prompts[0];
        promptsSection = `
          <div class="section-block">
            <div class="section-head">
              <span class="section-title">⚡ Ready-to-Paste Prompt</span>
            </div>
            <div class="prompt-box">
              <div class="prompt-header">
                <span class="prompt-target">${escapeHtml(p.label || 'Prompt')}</span>
                <button class="copy-btn" data-copy-type="prompt" data-post-id="${post.id}" data-prompt-idx="0">
                  📋 Copy Prompt
                </button>
              </div>
              <div class="prompt-content" id="prompt_${post.id}_0">${escapeHtml(p.text)}</div>
            </div>
          </div>
        `;
      } else {
        // Multi-slide prompts (Carousel)
        let slideTabs = '';
        let slideContents = '';
        post.prompts.forEach((p, idx) => {
          const activeClass = idx === 0 ? 'active' : '';
          const displayStyle = idx === 0 ? 'block' : 'none';
          slideTabs += `
            <button class="slide-tab-btn ${activeClass}" data-post-id="${post.id}" data-slide-idx="${idx}">
              Slide ${idx + 1}
            </button>
          `;
          slideContents += `
            <div class="carousel-slide-pane" id="pane_${post.id}_${idx}" style="display: ${displayStyle}">
              <div class="prompt-header">
                <span class="prompt-target">${escapeHtml(p.label)}</span>
                <button class="copy-btn" data-copy-type="prompt" data-post-id="${post.id}" data-prompt-idx="${idx}">
                  📋 Copy Slide ${idx + 1}
                </button>
              </div>
              <div class="prompt-content" id="prompt_${post.id}_${idx}">${escapeHtml(p.text)}</div>
            </div>
          `;
        });

        promptsSection = `
          <div class="section-block">
            <div class="section-head">
              <span class="section-title">⚡ Carousel Slides (${post.prompts.length} Prompts)</span>
            </div>
            <div class="carousel-slide-tabs">${slideTabs}</div>
            <div class="prompt-box">${slideContents}</div>
          </div>
        `;
      }
    }

    // Caption rendering
    let captionSection = '';
    if (post.caption && post.caption.trim() !== '') {
      captionSection = `
        <div class="section-block">
          <div class="section-head">
            <span class="section-title">✍️ Post Caption (Copy & Paste)</span>
          </div>
          <div class="caption-box">
            <div class="caption-header">
              <span class="caption-label">VERBATIM CAPTION</span>
              <button class="copy-caption-btn" data-copy-type="caption" data-post-id="${post.id}">
                📋 Copy Caption
              </button>
            </div>
            <div class="caption-content" id="caption_${post.id}">${escapeHtml(post.caption)}</div>
          </div>
        </div>
      `;
    }

    // Strategy block
    let strategyRows = '';
    if (post.hook) {
      strategyRows += `
        <div class="strategy-row">
          <div class="strategy-label">🎯 Scroll-Stopping Hook</div>
          <div class="hook-quote">"${escapeHtml(post.hook.replace(/^"|"$/g, ''))}"</div>
        </div>
      `;
    }
    if (post.message) {
      strategyRows += `
        <div class="strategy-row">
          <div class="strategy-label">💡 What it is about</div>
          <div class="strategy-value">${escapeHtml(post.message)}</div>
        </div>
      `;
    }
    if (post.cta) {
      strategyRows += `
        <div class="strategy-row">
          <div class="strategy-label">🚀 Call To Action</div>
          <div class="strategy-value">${escapeHtml(post.cta)}</div>
        </div>
      `;
    }
    if (post.attach) {
      strategyRows += `
        <div class="strategy-row">
          <div class="strategy-label">📎 What to Attach</div>
          <div class="strategy-value">${escapeHtml(post.attach)}</div>
        </div>
      `;
    }

    return `
      <article class="post-card ${isPosted ? 'posted' : ''}" id="card_${post.id}">
        <div class="card-header">
          <div class="card-badges">
            <span class="badge-doc ${docBadgeClass}">${escapeHtml(post.docName)}</span>
            <span class="badge-format">${escapeHtml(post.format || 'Post')}</span>
            ${post.pillar ? `<span class="badge-pillar">${escapeHtml(post.pillar)}</span>` : ''}
          </div>
          <div>
            <button class="posted-action-btn ${isPosted ? 'is-posted' : ''}" data-post-id="${post.id}">
              ${isPosted ? '✓ Posted' : 'Mark as Posted'}
            </button>
            ${isPosted && postedAt ? `<span class="posted-timestamp">${postedAt}</span>` : ''}
          </div>
        </div>

        <h2 class="card-title">${escapeHtml(post.title)}</h2>

        ${strategyRows ? `<div class="strategy-box">${strategyRows}</div>` : ''}

        ${promptsSection}

        ${captionSection}

        ${post.fullText ? `
          <details class="details-accordion">
            <summary class="details-summary">
              <span>📖 Full Verbatim Source Text</span>
            </summary>
            <div class="raw-source-text">${escapeHtml(post.fullText)}</div>
          </details>
        ` : ''}
      </article>
    `;
  }

  // --- ATTACH CARD LISTENERS ---
  function attachCardListeners() {
    // 1. Post mark toggling
    postsFeedEl.querySelectorAll('.posted-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const postId = btn.getAttribute('data-post-id');
        togglePostedStatus(postId);
      });
    });

    // 2. Carousel Slide Tabs
    postsFeedEl.querySelectorAll('.slide-tab-btn').forEach(tabBtn => {
      tabBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const postId = tabBtn.getAttribute('data-post-id');
        const slideIdx = tabBtn.getAttribute('data-slide-idx');
        
        const card = document.getElementById(`card_${postId}`);
        if (!card) return;

        card.querySelectorAll('.slide-tab-btn').forEach(b => b.classList.remove('active'));
        tabBtn.classList.add('active');

        card.querySelectorAll('.carousel-slide-pane').forEach((pane, idx) => {
          pane.style.display = idx.toString() === slideIdx ? 'block' : 'none';
        });
      });
    });

    // 3. Copy Prompt
    postsFeedEl.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const postId = btn.getAttribute('data-post-id');
        const promptIdx = btn.getAttribute('data-prompt-idx');
        const contentEl = document.getElementById(`prompt_${postId}_${promptIdx}`);
        if (contentEl) {
          copyToClipboard(contentEl.innerText, btn, 'Prompt Copied to Clipboard!');
        }
      });
    });

    // 4. Copy Caption
    postsFeedEl.querySelectorAll('.copy-caption-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const postId = btn.getAttribute('data-post-id');
        const captionEl = document.getElementById(`caption_${postId}`);
        if (captionEl) {
          copyToClipboard(captionEl.innerText, btn, 'Caption Copied to Clipboard!');
        }
      });
    });
  }

  // --- TOGGLE POSTED STATUS ---
  function togglePostedStatus(postId) {
    if (!userState[postId]) {
      userState[postId] = { posted: false };
    }

    const current = !userState[postId].posted;
    userState[postId].posted = current;
    
    if (current) {
      const now = new Date();
      const timeStr = now.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      userState[postId].postedAt = `Posted on ${timeStr}`;
      showToast('Marked as Posted! 🎉');
    } else {
      userState[postId].postedAt = null;
      showToast('Marked as Unposted');
    }

    saveUserState();

    // If active filter is 'posted' or 'unposted', re-render feed so post moves to proper tab
    if (currentStatusFilter !== 'all') {
      renderFeed();
    } else {
      // Inline update card
      const card = document.getElementById(`card_${postId}`);
      if (card) {
        if (current) {
          card.classList.add('posted');
        } else {
          card.classList.remove('posted');
        }
        const btn = card.querySelector('.posted-action-btn');
        if (btn) {
          btn.classList.toggle('is-posted', current);
          btn.innerHTML = current ? '✓ Posted' : 'Mark as Posted';
        }
        let tsSpan = card.querySelector('.posted-timestamp');
        if (current) {
          if (!tsSpan) {
            tsSpan = document.createElement('span');
            tsSpan.className = 'posted-timestamp';
            btn.parentElement.appendChild(tsSpan);
          }
          tsSpan.textContent = userState[postId].postedAt;
        } else if (tsSpan) {
          tsSpan.remove();
        }
      }
    }
  }

  // --- COPY TO CLIPBOARD ---
  function copyToClipboard(text, btnElement, successMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        handleCopySuccess(btnElement, successMsg);
      }).catch(() => {
        fallbackCopyText(text, btnElement, successMsg);
      });
    } else {
      fallbackCopyText(text, btnElement, successMsg);
    }
  }

  function fallbackCopyText(text, btnElement, successMsg) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      handleCopySuccess(btnElement, successMsg);
    } catch (err) {
      console.error('Fallback copy failed', err);
      showToast('Copy failed, please select and copy manually.');
    }
    document.body.removeChild(ta);
  }

  function handleCopySuccess(btnElement, successMsg) {
    showToast(successMsg);
    if (btnElement) {
      const originalText = btnElement.innerHTML;
      btnElement.classList.add('copied');
      btnElement.innerHTML = '✓ Copied!';
      setTimeout(() => {
        btnElement.classList.remove('copied');
        btnElement.innerHTML = originalText;
      }, 2000);
    }
  }

  // --- TOAST NOTIFICATION ---
  let toastTimeout = null;
  function showToast(message) {
    if (!toastNoticeEl) return;
    if (toastTextEl) toastTextEl.textContent = message;
    toastNoticeEl.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastNoticeEl.classList.remove('show');
    }, 2500);
  }

  // --- EVENT LISTENERS ---
  function setupEventListeners() {
    // Search input
    if (searchInputEl) {
      searchInputEl.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        if (clearSearchBtn) {
          clearSearchBtn.style.display = searchQuery ? 'block' : 'none';
        }
        renderFeed();
      });
    }

    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => {
        searchInputEl.value = '';
        searchQuery = '';
        clearSearchBtn.style.display = 'none';
        renderFeed();
      });
    }

    // Status pills
    statusPills.forEach(pill => {
      pill.addEventListener('click', () => {
        statusPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        currentStatusFilter = pill.getAttribute('data-status');
        renderFeed();
      });
    });

    // Format dropdown
    if (formatSelectEl) {
      formatSelectEl.addEventListener('change', (e) => {
        currentFormatFilter = e.target.value;
        renderFeed();
      });
    }

    // Scroll to Top
    window.addEventListener('scroll', () => {
      if (scrollTopBtn) {
        if (window.scrollY > 300) {
          scrollTopBtn.classList.add('visible');
        } else {
          scrollTopBtn.classList.remove('visible');
        }
      }
    });

    if (scrollTopBtn) {
      scrollTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    // Backup & Restore
    const backupBtn = document.getElementById('backupBtn');
    if (backupBtn) {
      backupBtn.addEventListener('click', exportBackup);
    }

    const restoreInput = document.getElementById('restoreInput');
    if (restoreInput) {
      restoreInput.addEventListener('change', importBackup);
    }
  }

  // --- EXPORT & IMPORT BACKUP ---
  function exportBackup() {
    const backupData = {
      version: 1,
      appName: 'NolMart Post Tracker',
      exportedAt: new Date().toISOString(),
      userState: userState
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nolmart_posts_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Progress backup exported!');
  }

  function importBackup(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (imported && imported.userState) {
          userState = imported.userState;
          saveUserState();
          renderFeed();
          showToast('Progress restored successfully!');
        } else {
          showToast('Invalid backup file format');
        }
      } catch (err) {
        showToast('Error reading backup file');
      }
    };
    reader.readAsText(file);
  }

  // --- PWA SETUP ---
  let deferredPrompt = null;
  function setupPWA() {
    // Register Service Worker
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then(reg => console.log('SW Registered:', reg.scope))
          .catch(err => console.log('SW Registration failed:', err));
      });
    }

    // Capture install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (installBannerEl) installBannerEl.style.display = 'flex';
    });

    if (installAppBtn) {
      installAppBtn.addEventListener('click', () => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          deferredPrompt.userChoice.then((choice) => {
            if (choice.outcome === 'accepted') {
              showToast('Thank you for installing NolMart Tracker!');
            }
            deferredPrompt = null;
            if (installBannerEl) installBannerEl.style.display = 'none';
          });
        }
      });
    }

    if (closeInstallBannerBtn) {
      closeInstallBannerBtn.addEventListener('click', () => {
        if (installBannerEl) installBannerEl.style.display = 'none';
      });
    }
  }

  // --- ESCAPE HTML ---
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Run on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose global helpers for HTML attributes if needed
  window.NolMartApp = {
    exportBackup,
    togglePostedStatus
  };

})();

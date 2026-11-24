/* ============================================================
   hud.js — DOM 界面（状态栏 / 建造清单 / 提示 / 结算）
   ------------------------------------------------------------
   建造清单只在开局构建一次，之后每帧只切换 class，
   避免频繁重建 DOM 导致 hover 状态闪断。

   窄屏（手机）下侧栏变成底部横条，一次只显示一组，
   由 #tabs 决定显示哪一组；宽屏时 #tabs 隐藏、全组竖排。
   分组隐藏只写在紧凑断点里，所以横竖屏来回切不会把清单搞丢。
   ============================================================ */

window.HJ = window.HJ || {};

HJ.HUD = {
  state: null,
  cards: {},        // id -> { el, costEl }
  groups: {},       // 组名 -> 元素
  tab: '全部',
  compact: false,
  lastMoney: -1,
  lastUpdate: 0,
  toastTimer: 0,
  titleMode: HJ.Config.DEFAULT_MODE,
  queueKey: '',

  /* 和 layout.css 的紧凑断点保持一致 */
  MQ_COMPACT: '(max-width: 860px), (max-height: 560px)',

  init(state) {
    this.state = state;
    this.cards = {};
    this.groups = {};
    this.lastMoney = -1;

    document.getElementById('gameover').classList.add('hidden');
    document.getElementById('toast').classList.remove('show');

    this.compact = window.matchMedia(this.MQ_COMPACT).matches;
    this.buildMapSelect();
    this.buildShop();
    this.buildTabs();
    /* 窄屏一次只显示一组，开局停在第一组；宽屏全部竖排显示 */
    this.setTab(this.compact ? Object.keys(HJ.BuildOrder)[0] : '全部');
    this.resetHint();
    this.syncCommands();
    this.update(true);

    if (!this._bound) {
      this._bound = true;
      window.addEventListener('resize', () => this.onResize());
      const mapSelect = document.getElementById('map-select');
      if (mapSelect) mapSelect.addEventListener('change', () => HJ.Game.newGame(mapSelect.value));
    }
  },

  onResize() {
    const compact = window.matchMedia(this.MQ_COMPACT).matches;
    if (compact === this.compact) return;
    this.compact = compact;
    this.setTab(compact ? Object.keys(HJ.BuildOrder)[0] : '全部');
    this.resetHint();
  },

  HINT_MOUSE: '选中一项后点击地图放置；点己方单位指挥换防，点建筑查看属性，右键取消或拆除。',
  HINT_TOUCH: '单指拖动平移 · 双指缩放 · 轻点放置。点己方单位换防，点建筑查看；「拆除」返还 50% 造价。',

  resetHint() {
    const el = document.getElementById('side-hint');
    if (el) el.textContent = this.compact ? this.HINT_TOUCH : this.HINT_MOUSE;
  },

  /* ---------------- 标题 ---------------- */

  buildTitle() {
    this.titleMode = HJ.Config.MODES[HJ.Game.mode] ? HJ.Game.mode : HJ.Config.DEFAULT_MODE;
    const modes = document.getElementById('title-modes');
    modes.innerHTML = '';
    for (const id in HJ.Config.MODES) {
      const mode = HJ.Config.MODES[id];
      const button = document.createElement('button');
      button.className = 'title-mode' + (id === this.titleMode ? ' active' : '');
      button.dataset.mode = id;
      const name = document.createElement('strong');
      name.textContent = mode.name;
      const desc = document.createElement('span');
      desc.textContent = mode.desc;
      button.append(name, desc);
      button.addEventListener('click', () => {
        this.titleMode = id;
        for (const b of modes.children) b.classList.toggle('active', b.dataset.mode === id);
        this.buildTitleMaps();
      });
      modes.appendChild(button);
    }
    this.buildTitleMaps();
    if (!this._titleBound) {
      this._titleBound = true;
      document.getElementById('btn-start').addEventListener('click', () => {
        HJ.Game.start(this.titleMode, document.getElementById('title-map').value);
      });
    }
  },

  buildTitleMaps() {
    const select = document.getElementById('title-map');
    const desc = document.getElementById('title-map-desc');
    select.innerHTML = '';
    for (const id in HJ.Maps) {
      const map = HJ.Maps[id];
      if (this.titleMode === 'skirmish' ? map.mode !== 'skirmish' : map.mode !== 'defense') continue;
      const option = document.createElement('option');
      option.value = id;
      option.textContent = map.name;
      select.appendChild(option);
    }
    this.syncTitleMap();
    select.onchange = () => this.syncTitleMap();
  },

  syncTitleMap() {
    const select = document.getElementById('title-map');
    const map = HJ.Maps[select.value];
    document.getElementById('title-map-desc').textContent = map ? map.desc : '';
  },

  /* ---------------- 建造清单 ---------------- */

  buildMapSelect() {
    const select = document.getElementById('map-select');
    if (!select) return;
    select.innerHTML = '';
    for (const id in HJ.Maps) {
      const map = HJ.Maps[id];
      if (HJ.Game.mode === 'skirmish' ? map.mode !== 'skirmish' : map.mode !== 'defense') continue;
      const option = document.createElement('option');
      option.value = id;
      option.textContent = map.name;
      select.appendChild(option);
    }
    select.value = this.state.map.id;
  },

  buildTabs() {
    const bar = document.getElementById('tabs');
    if (!bar) return;
    bar.innerHTML = '';
    for (const name of ['全部'].concat(Object.keys(HJ.BuildOrder))) {
      const b = document.createElement('button');
      b.className = 'tab';
      b.textContent = name;
      b.dataset.name = name;
      b.addEventListener('click', () => this.setTab(name));
      bar.appendChild(b);
    }
  },

  setTab(name) {
    this.tab = name;
    for (const g in this.groups) {
      this.groups[g].classList.toggle('tab-hide', name !== '全部' && g !== name);
    }
    const bar = document.getElementById('tabs');
    if (!bar) return;
    for (const b of bar.children) b.classList.toggle('active', b.dataset.name === name);
  },

  buildShop() {
    const shop = document.getElementById('shop');
    shop.innerHTML = '';

    const tagText = {
      'anti-inf': '反步兵',
      'anti-arm': '反装甲',
      'anti-bld': '拆建筑',
      'hero': '英雄',
    };
    const tagClass = {
      'anti-inf': 'tag-anti-inf',
      'anti-arm': 'tag-anti-arm',
      'anti-bld': 'tag-anti-bld',
      'hero': 'tag-hero',
    };

    for (const groupName in HJ.BuildOrder) {
      const ids = HJ.BuildOrder[groupName];

      const group = document.createElement('div');
      group.className = 'shop-group';
      this.groups[groupName] = group;

      const title = document.createElement('div');
      title.className = 'shop-group-title';
      title.textContent = groupName;
      group.appendChild(title);

      for (const id of ids) {
        const d = HJ.Units[id];
        if (!d) continue;

        const card = document.createElement('div');
        card.className = 'card';
        card.dataset.id = id;

        const icon = document.createElement('div');
        icon.className = 'card-icon';
        icon.style.background = d.color;
        icon.textContent = d.icon;

        const body = document.createElement('div');
        body.className = 'card-body';

        const nameRow = document.createElement('div');
        nameRow.className = 'card-name';
        const nameSpan = document.createElement('span');
        nameSpan.textContent = d.name;
        const costSpan = document.createElement('span');
        costSpan.className = 'card-cost';
        costSpan.textContent = d.cost;
        nameRow.appendChild(nameSpan);
        nameRow.appendChild(costSpan);

        const meta = document.createElement('div');
        meta.className = 'card-spec';
        const chips = ['HP ' + d.hp];
        /* 建筑尺寸必须让玩家看见 —— 3×3 和 1×1 在战术上完全是两种东西 */
        if (d.kind === 'building') chips.push((d.size || 1) + '×' + (d.size || 1));
        if (d.range) chips.push('射程 ' + d.range);
        if (d.damage) chips.push('伤害 ' + d.damage);
        if (d.leash !== undefined) {
          chips.push(d.leash > 0 ? '牵引 ' + d.leash : '原地不动');
        }
        if (d.power > 0) chips.push('+' + d.power + ' 电');
        else if (d.power < 0) chips.push(d.power + ' 电');
        for (const c of chips) {
          const s = document.createElement('span');
          s.textContent = c;
          meta.appendChild(s);
        }

        body.appendChild(nameRow);
        body.appendChild(meta);

        if (d.tags && d.tags.length) {
          const tagRow = document.createElement('div');
          tagRow.className = 'card-meta card-tags';
          for (const t of d.tags) {
            const tag = document.createElement('span');
            tag.className = 'tag ' + (tagClass[t] || '');
            tag.textContent = tagText[t] || t;
            tagRow.appendChild(tag);
          }
          body.appendChild(tagRow);
        }

        card.appendChild(icon);
        card.appendChild(body);

        /* 悬停时把详细说明放在 title 里，不占版面 */
        card.title = d.desc || '';

        card.addEventListener('click', () => this.onCardClick(id));
        card.addEventListener('mouseenter', (e) => this.showHint(d));

        group.appendChild(card);
        this.cards[id] = { el: card, costEl: costSpan, data: d };
      }

      shop.appendChild(group);
    }
  },

  onCardClick(id) {
    const s = this.state;
    const d = HJ.Units[id];
    /* 手指没有 hover，说明文字必须跟着点击一起出来 */
    this.showHint(d);
    if (!HJ.Economy.isUnlocked(s, id)) {
      const need = HJ.Units[HJ.Units[id].unlock];
      this.toast('需要先造' + (need ? need.name : '前置建筑'), true);
      return;
    }
    if (!HJ.Economy.canAfford(s, id)) {
      this.toast('资金不足', true);
      return;
    }
    if (d.kind !== 'building') {
      const res = HJ.Economy.enqueue(s, id);
      HJ.Input.clearCommand();
      this.toast(res.ok ? d.name + ' 已加入生产队列' : res.reason, !res.ok);
      this.update(true);
      return;
    }
    /* 再点一次同一张卡 = 取消，手机上没有右键 */
    const want = (s.selected === id) ? null : id;
    /* 开始选建筑就意味着放弃单位指挥，两种选中不能同时存在 */
    HJ.Input.clearCommand();
    s.selected = want;
    this.update(true);
  },

  showHint(d) {
    const el = document.getElementById('side-hint');
    if (!el) return;
    el.textContent = d.desc || '';
  },

  showEntity(u) {
    const el = document.getElementById('side-hint');
    if (!el || !u) return;
    const parts = [u.name, 'HP ' + Math.ceil(u.hp) + '/' + u.maxHp];
    if (u.isBuilding) parts.push('占地 ' + (u.size || 1) + '×' + (u.size || 1));
    if (u.range) parts.push('射程 ' + u.range);
    if (u.damage) parts.push('伤害 ' + u.damage);
    if (u.canMove) parts.push(u.leash > 0 ? '牵引 ' + u.leash : '原地防守');
    if (u.power > 0) parts.push('+' + u.power + ' 电');
    else if (u.power < 0) parts.push(u.power + ' 电');
    el.textContent = parts.join(' · ');
  },

  syncHint() {
    const s = this.state;
    if (!s) return;
    if (s.sellMode) {
      this.showHint({ desc: '拆除模式：轻点己方建筑拆除，返还 50% 造价。再点「拆除」或「取消」退出。' });
    } else if (s.inspected && s.inspected.alive) {
      this.showEntity(s.inspected);
    } else if (s.deployMode && s.selectedUnit && s.selectedUnit.alive) {
      this.showHint({ desc: 'MCV 展开：轻点 4×4 空地部署基地；「取消」退出。' });
    } else if (s.selectedUnit && s.selectedUnit.alive) {
      this.showEntity(s.selectedUnit);
      const el = document.getElementById('side-hint');
      if (el) el.textContent += ' · 轻点空地换防';
    } else if (s.selected && HJ.Units[s.selected]) {
      this.showHint(HJ.Units[s.selected]);
      const d = HJ.Units[s.selected];
      if (d.kind === 'building' && s.hover.valid && s.hover.col >= 0) {
        const preview = HJ.Field.preview(s, s.hover.col, s.hover.row, d.size || 1);
        const el = document.getElementById('side-hint');
        if (preview.changed) el.textContent += preview.reachable
          ? ' · 黄线：' + preview.changed + ' 条入侵路线将改变'
          : ' · 警告：放置后将有入口无法到达基地';
      }
    } else {
      this.resetHint();
    }
  },

  /* 指挥按钮的可用性：没有选中任何东西时按了也没意义 */
  syncCommands() {
    const s = this.state;
    const cancel = document.getElementById('cmd-cancel');
    const same = document.getElementById('cmd-same');
    const sell = document.getElementById('cmd-sell');
    if (cancel) cancel.classList.toggle('off', !(s && (s.selected || s.selectedUnit || s.inspected || s.sellMode || s.deployMode)));
    if (same) same.classList.toggle('on', !!(s && s.selectedUnit));
    if (sell) sell.classList.toggle('on', !!(s && s.sellMode));
  },

  /* ---------------- 每帧刷新 ---------------- */

  update(force) {
    const s = this.state;
    if (!s) return;
    const now = performance.now();
    if (!force && now - this.lastUpdate < 90) return;
    this.lastUpdate = now;

    /* 领队被打掉之后，整个指挥状态都要跟着清 */
    if (s.selectedUnit && !s.selectedUnit.alive) {
      HJ.Input.clearCommand();
      this.syncHint();
    }
    if (s.inspected && !s.inspected.alive) {
      s.inspected = null;
      this.syncHint();
    }
    if (force) this.syncHint();

    /* 顶栏 */
    const money = Math.round(s.money);
    const moneyEl = document.getElementById('s-money');
    moneyEl.textContent = HJ.Utils.fmt(money);
    if (this.lastMoney >= 0 && money !== this.lastMoney) {
      moneyEl.classList.toggle('flash-up', money > this.lastMoney);
      moneyEl.classList.toggle('flash-down', money < this.lastMoney);
      clearTimeout(this._moneyTimer);
      this._moneyTimer = setTimeout(() => {
        moneyEl.classList.remove('flash-up', 'flash-down');
      }, 220);
    }
    this.lastMoney = money;

    document.getElementById('s-power').textContent = s.usedPower + '/' + s.totalPower;
    document.getElementById('stat-power-box').classList.toggle('low', s.lowPower);

    /* 这一格两种语义：开波后是进度，备战时是倒计时。
       标签跟着换，玩家才知道那个数字是什么，数字本身也短一半 */
    const waveEl = document.getElementById('s-wave');
    const waveLabel = document.getElementById('s-wave-label');
    if (s.mode === 'skirmish') {
      if (waveLabel) waveLabel.textContent = '战斗';
      waveEl.textContent = Math.floor(s.time / 60) + ':' + String(Math.floor(s.time % 60)).padStart(2, '0');
    } else if (s.waveActive) {
      if (waveLabel) waveLabel.textContent = '波次';
      waveEl.textContent = (s.waveIndex + 1) + (s.mode === 'endless' ? '/∞' : '/' + HJ.Waves.length);
    } else if (!s.over) {
      if (waveLabel) waveLabel.textContent = '下一波';
      waveEl.textContent = Math.ceil(Math.max(0, s.prepTimer)) + 's';
    }

    const baseEl = document.getElementById('s-base');
    if (s.base) {
      const basePct = Math.max(0, Math.round((s.base.hp / s.base.maxHp) * 100));
      baseEl.textContent = basePct + '%';
      baseEl.style.color = basePct > 60 ? 'var(--text)' : basePct > 30 ? 'var(--warn)' : 'var(--red)';
    } else {
      baseEl.textContent = '待展开';
      baseEl.style.color = 'var(--gold-2)';
    }
    const brand = document.querySelector('.brand');
    if (brand) brand.childNodes[1].textContent = '红警前线 · ' + HJ.Config.MODES[s.mode].short;

    /* 侧栏电力状态 */
    const sp = document.getElementById('side-power');
    sp.textContent = s.lowPower ? '电力不足 · 射速 -30%' : '电力充足';
    sp.classList.toggle('low', s.lowPower);

    /* 建造卡片状态 */
    for (const id in this.cards) {
      const c = this.cards[id];
      const unlocked = HJ.Economy.isUnlocked(s, id);
      const afford = HJ.Economy.canAfford(s, id);
      c.el.classList.toggle('locked', !unlocked || !afford);
      c.el.classList.toggle('selected', s.selected === id);
      c.costEl.style.color = afford ? '' : 'var(--red)';
    }
    this.updateQueue();
    this.syncCommands();
  },

  updateQueue() {
    const queue = this.state.sides.player.queue;
    const key = queue.map(item => item.defId + ':' + Math.ceil(item.remaining * 5)).join('|');
    const box = document.getElementById('queue');
    if (key === this.queueKey) return;
    this.queueKey = key;
    box.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'queue-head';
    const title = document.createElement('span');
    title.textContent = '生产队列';
    const count = document.createElement('span');
    count.textContent = queue.length + '/' + HJ.Config.MAX_QUEUE;
    head.append(title, count);
    box.appendChild(head);
    if (!queue.length) {
      const empty = document.createElement('div');
      empty.className = 'queue-empty';
      empty.textContent = '点击兵种卡片排队生产';
      box.appendChild(empty);
      return;
    }
    queue.forEach((item, index) => {
      const d = HJ.Units[item.defId];
      const row = document.createElement('div');
      row.className = 'queue-item';
      const name = document.createElement('span');
      name.className = 'queue-name';
      name.textContent = (index === 0 ? '▶ ' : '') + d.name;
      const time = document.createElement('span');
      time.className = 'queue-time';
      time.textContent = item.remaining <= 0 ? '等待' : Math.ceil(item.remaining) + 's';
      const cancel = document.createElement('button');
      cancel.className = 'queue-cancel';
      cancel.textContent = '×';
      cancel.title = '取消并全额退款';
      cancel.addEventListener('click', () => {
        const refund = HJ.Economy.cancelQueue(this.state, index);
        this.toast('已取消 · 退款 ' + refund);
        this.update(true);
      });
      const bar = document.createElement('div');
      bar.className = 'queue-progress';
      const fill = document.createElement('i');
      fill.style.width = ((1 - Math.max(0, item.remaining) / item.total) * 100).toFixed(1) + '%';
      bar.appendChild(fill);
      row.append(name, time, cancel, bar);
      box.appendChild(row);
    });
  },

  /* ---------------- 提示 ---------------- */

  toast(msg, warn) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.toggle('warn', !!warn);
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  },

  /* ---------------- 结算 ---------------- */

  gameOver(state, waveIndex, won) {
    if (HJ.Sfx) {
      HJ.Sfx.play(won ? 'win' : 'lose');
      /* 结算音要盖过 BGM，先把循环停掉，否则失败画面还在打仗 */
      HJ.Sfx.stopBGM();
    }
    const box = document.getElementById('gameover');
    box.classList.remove('hidden');

    box.querySelector('.go-title').textContent = won
      ? (state.mode === 'skirmish' ? '敌方基地已摧毁' : state.mode === 'endless' ? '防线坚持到了最后' : '防线守住了')
      : (state.mode === 'skirmish' ? '作战失败' : '基地失守');
    box.querySelector('.go-title').style.color = won ? 'var(--gold-2)' : 'var(--red)';

    const sub = document.getElementById('go-sub');
    sub.textContent = state.mode === 'skirmish'
      ? '战斗用时 ' + Math.floor(state.time / 60) + ':' + String(Math.floor(state.time % 60)).padStart(2, '0') + ' · 击杀 ' + state.killCount
      : won
        ? '全部 ' + HJ.Waves.length + ' 波清空，击杀 ' + state.killCount + ' 个单位'
        : '撑到了第 ' + waveIndex + ' 波，击杀 ' + state.killCount + ' 个单位';
  },
};

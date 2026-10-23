/* ============================================================
   hud.js — DOM 界面（状态栏 / 建造清单 / 提示 / 结算）
   ------------------------------------------------------------
   建造清单只在开局构建一次，之后每帧只切换 class，
   避免频繁重建 DOM 导致 hover 状态闪断。
   ============================================================ */

window.HJ = window.HJ || {};

HJ.HUD = {
  state: null,
  cards: {},        // id -> { el, costEl }
  lastMoney: -1,
  lastUpdate: 0,
  toastTimer: 0,

  init(state) {
    this.state = state;
    this.cards = {};
    this.lastMoney = -1;

    document.getElementById('gameover').classList.add('hidden');
    document.getElementById('toast').classList.remove('show');

    this.buildShop();
    this.update(true);
  },

  /* ---------------- 建造清单 ---------------- */

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
        meta.className = 'card-meta';
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
          tagRow.className = 'card-meta';
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
    if (!HJ.Economy.isUnlocked(s, id)) {
      const need = HJ.Units[HJ.Units[id].unlock];
      this.toast('需要先造' + (need ? need.name : '前置建筑'), true);
      return;
    }
    if (!HJ.Economy.canAfford(s, id)) {
      this.toast('资金不足', true);
      return;
    }
    s.selected = (s.selected === id) ? null : id;
    /* 开始选建筑就意味着放弃单位指挥，两种选中不能同时存在 */
    s.selectedUnit = null;
    this.update(true);
  },

  showHint(d) {
    const el = document.getElementById('side-hint');
    if (!el) return;
    el.textContent = d.desc || '';
  },

  /* ---------------- 每帧刷新 ---------------- */

  update(force) {
    const s = this.state;
    const now = performance.now();
    if (!force && now - this.lastUpdate < 90) return;
    this.lastUpdate = now;

    /* 顶栏 */
    const moneyEl = document.getElementById('s-money');
    moneyEl.textContent = HJ.Utils.fmt(s.money);
    if (this.lastMoney >= 0 && s.money !== this.lastMoney) {
      moneyEl.classList.toggle('flash-up', s.money > this.lastMoney);
      moneyEl.classList.toggle('flash-down', s.money < this.lastMoney);
      clearTimeout(this._moneyTimer);
      this._moneyTimer = setTimeout(() => {
        moneyEl.classList.remove('flash-up', 'flash-down');
      }, 220);
    }
    this.lastMoney = s.money;

    document.getElementById('s-power').textContent = s.usedPower + ' / ' + s.totalPower;
    document.getElementById('stat-power-box').classList.toggle('low', s.lowPower);

    const waveEl = document.getElementById('s-wave');
    if (s.waveActive) {
      waveEl.textContent = (s.waveIndex + 1) + ' / ' + HJ.Waves.length;
    } else if (!s.over) {
      waveEl.textContent = Math.ceil(Math.max(0, s.prepTimer)) + 's · ' + (s.waveIndex + 1) + '/' + HJ.Waves.length;
    }

    const basePct = Math.max(0, Math.round((s.base.hp / s.base.maxHp) * 100));
    const baseEl = document.getElementById('s-base');
    baseEl.textContent = basePct + '%';
    baseEl.style.color = basePct > 60 ? 'var(--text)' : basePct > 30 ? 'var(--warn)' : 'var(--red)';

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
    if (HJ.Sfx) HJ.Sfx.play(won ? 'win' : 'lose');
    const box = document.getElementById('gameover');
    box.classList.remove('hidden');

    box.querySelector('.go-title').textContent = won ? '防线守住了' : '基地失守';
    box.querySelector('.go-title').style.color = won ? 'var(--gold-2)' : 'var(--red)';

    const sub = document.getElementById('go-sub');
    sub.textContent = won
      ? '全部 ' + HJ.Waves.length + ' 波清空，击杀 ' + state.killCount + ' 个单位'
      : '撑到了第 ' + waveIndex + ' 波，击杀 ' + state.killCount + ' 个单位';
  },
};

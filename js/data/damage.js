/* ============================================================
   damage.js — 弹头 × 护甲 克制矩阵
   ------------------------------------------------------------
   这是整个游戏平衡的地基，对应红警 2 的 Verses 百分比表。
   数值含义：最终伤害 = 武器伤害 × 矩阵[弹头][护甲]

   四档护甲：
     none     步兵（无甲）
     light    轻甲车辆（光棱、防空车）
     heavy    重甲坦克（犀牛、灰熊、天启）
     building 建筑

   想改克制关系，只改这张表，不用碰战斗代码。
   ============================================================ */

window.HJ = window.HJ || {};

HJ.Damage = {
  armors: ['none', 'light', 'heavy', 'building'],

  armorName: {
    none: '步兵',
    light: '轻甲',
    heavy: '重甲',
    building: '建筑',
  },

  warheads: {
    /* 小口径：步枪、机伦碉堡。
       打步兵满伤，对装甲只有 25% —— 二十个步兵能磨死一辆坦克，
       但会被坦克一路碾过来，所以步兵仍然不该单独面对装甲 */
    SA: { none: 1.00, light: 0.50, heavy: 0.25, building: 0.25 },

    /* 穿甲：坦克主炮。反装甲主力，打步兵浪费 */
    AP: { none: 0.25, light: 1.00, heavy: 0.75, building: 0.50 },

    /* 高爆：火箭、C4、炮击。拆建筑和清步兵都强，反坦克一般 */
    HE: { none: 1.00, light: 0.50, heavy: 0.25, building: 1.00 },

    /* 光棱：穿透 + 溅射。对建筑极强，对步兵一般 */
    PRISM: { none: 0.50, light: 0.80, heavy: 0.60, building: 1.00 },

    /* 磁暴：苏军线圈。对什么都能打，但没有极端值 */
    TESLA: { none: 1.00, light: 0.75, heavy: 0.75, building: 0.75 },

    /* 英雄：谭雅。秒步兵、秒建筑，对车辆完全无效 —— 红警原版设定 */
    HERO: { none: 1.00, light: 0.00, heavy: 0.00, building: 1.00 },
  },

  /**
   * 查表拿倍率
   * @param {string} warhead 弹头类型
   * @param {string} armor   目标护甲
   * @returns {number} 0 ~ 1 之间的倍率
   */
  resolve(warhead, armor) {
    const table = this.warheads[warhead];
    if (!table) return 1;
    const v = table[armor];
    return v === undefined ? 1 : v;
  },

  /**
   * 计算一次攻击的实际伤害
   * @returns {{amount:number, mult:number}}
   */
  calc(baseDamage, warhead, armor, bonus) {
    const mult = this.resolve(warhead, armor);
    const b = bonus || 1;
    return { amount: baseDamage * mult * b, mult };
  },
};

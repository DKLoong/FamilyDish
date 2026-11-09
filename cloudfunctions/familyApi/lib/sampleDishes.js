// 5 道自行整理的示例菜，按常见家常做法重写，不使用第三方图片、不复制第三方正文。
// 选材覆盖：可合并的数值用量（食用油 15ml 出现两次）、无具体数量的「适量」、
// 无步骤图片、多个分类、不同总耗时（10–60 分钟）。
// 仅作首次使用的演示数据，由 seedSampleDishes 一次性导入。
module.exports = [
  {
    name: '番茄炒蛋',
    category: '家常菜',
    difficulty: '简单',
    time: 15,
    description: '酸甜下饭的基础菜。鸡蛋先炒散再回锅，口感更嫩。',
    ingredients: [
      { key: 'i1', name: '番茄', quantity: 300, unit: 'g', note: '' },
      { key: 'i2', name: '鸡蛋', quantity: 150, unit: 'g', note: '' },
      { key: 'i3', name: '食用油', quantity: 15, unit: 'ml', note: '' },
      { key: 'i4', name: '白糖', quantity: 5, unit: 'g', note: '' },
      { key: 'i5', name: '盐', quantity: null, unit: '', note: '适量' }
    ],
    steps: [
      { text: '番茄切块；鸡蛋打散，加少许盐拌匀。', minutes: 3, image: '' },
      { text: '热锅倒油，倒入蛋液快速划散，刚凝固就盛出。', minutes: 2, image: '' },
      { text: '原锅下番茄块，中火炒出汁水，加白糖和盐调味。', minutes: 5, image: '' },
      { text: '把炒蛋倒回锅中翻匀，出锅。', minutes: 2, image: '' }
    ],
    tips: '番茄先用开水烫一下去皮，汤汁会更浓。'
  },
  {
    name: '清蒸鲈鱼',
    category: '荤菜',
    difficulty: '中等',
    time: 25,
    description: '只用蒸和淋油两步，突出鱼本身的鲜味。',
    ingredients: [
      { key: 'i1', name: '鲈鱼', quantity: 600, unit: 'g', note: '处理干净' },
      { key: 'i2', name: '姜', quantity: 10, unit: 'g', note: '切片' },
      { key: 'i3', name: '小葱', quantity: 20, unit: 'g', note: '切丝' },
      { key: 'i4', name: '蒸鱼豉油', quantity: 30, unit: 'ml', note: '' },
      { key: 'i5', name: '食用油', quantity: 20, unit: 'ml', note: '' }
    ],
    steps: [
      { text: '鱼身两面各划两刀，鱼腹和刀口塞姜片。', minutes: 5, image: '' },
      { text: '水开后上锅，大火蒸 8 分钟，关火焖 2 分钟。', minutes: 10, image: '' },
      { text: '倒掉盘中蒸出的水，去掉姜片，铺上葱丝。', minutes: 2, image: '' },
      { text: '淋蒸鱼豉油。', minutes: 1, image: '' },
      { text: '另起锅把油烧到微微冒烟，浇在葱丝上。', minutes: 3, image: '' }
    ],
    tips: '蒸之前把鱼擦干，腥味更少；蒸出的水一定要倒掉。'
  },
  {
    name: '蒜蓉西兰花',
    category: '素菜',
    difficulty: '简单',
    time: 12,
    description: '先焯后炒，能保住颜色和脆度。',
    ingredients: [
      { key: 'i1', name: '西兰花', quantity: 400, unit: 'g', note: '切小朵' },
      { key: 'i2', name: '大蒜', quantity: 15, unit: 'g', note: '切末' },
      { key: 'i3', name: '食用油', quantity: 15, unit: 'ml', note: '' },
      { key: 'i4', name: '盐', quantity: null, unit: '', note: '适量' }
    ],
    steps: [
      { text: '西兰花用淡盐水泡 5 分钟后冲净。', minutes: 5, image: '' },
      { text: '水开加少许盐和几滴油，下西兰花焯 1 分钟，捞出沥干。', minutes: 3, image: '' },
      { text: '热锅下油炒香蒜末，倒入西兰花快速翻炒，加盐出锅。', minutes: 3, image: '' }
    ],
    tips: '焯水时加油能让颜色更绿，时间不要超过 1 分钟。'
  },
  {
    name: '红烧排骨',
    category: '荤菜',
    difficulty: '较难',
    time: 60,
    description: '炒糖色是成败关键，火小一点更稳。',
    ingredients: [
      { key: 'i1', name: '排骨', quantity: 800, unit: 'g', note: '切段' },
      { key: 'i2', name: '冰糖', quantity: 20, unit: 'g', note: '' },
      { key: 'i3', name: '生抽', quantity: 30, unit: 'ml', note: '' },
      { key: 'i4', name: '老抽', quantity: 10, unit: 'ml', note: '' },
      { key: 'i5', name: '料酒', quantity: 20, unit: 'ml', note: '' },
      { key: 'i6', name: '姜', quantity: 10, unit: 'g', note: '切片' },
      { key: 'i7', name: '八角', quantity: 2, unit: 'g', note: '两颗' },
      { key: 'i8', name: '盐', quantity: null, unit: '', note: '适量' }
    ],
    steps: [
      { text: '排骨冷水下锅，加料酒和姜片，煮开后撇净浮沫，捞出冲净。', minutes: 10, image: '' },
      { text: '锅中放少量油和冰糖，小火炒到糖化开、颜色变枣红。', minutes: 5, image: '' },
      { text: '下排骨翻炒上色，加生抽、老抽炒匀。', minutes: 5, image: '' },
      { text: '加开水没过排骨，放姜片和八角，大火烧开转小火。', minutes: 5, image: '' },
      { text: '盖盖炖 30 分钟，中途翻动一次。', minutes: 30, image: '' },
      { text: '开盖转大火收汁，加盐调味，汤汁挂在排骨上即可。', minutes: 8, image: '' }
    ],
    tips: '一定要加开水，冷水会让肉质变紧。收汁时勤翻动，避免糊底。'
  },
  {
    name: '紫菜蛋花汤',
    category: '汤品',
    difficulty: '简单',
    time: 10,
    description: '水开后转小火再淋蛋液，蛋花才会细。',
    ingredients: [
      { key: 'i1', name: '紫菜', quantity: 5, unit: 'g', note: '' },
      { key: 'i2', name: '鸡蛋', quantity: 100, unit: 'g', note: '打散' },
      { key: 'i3', name: '虾皮', quantity: 5, unit: 'g', note: '' },
      { key: 'i4', name: '水', quantity: 800, unit: 'ml', note: '' },
      { key: 'i5', name: '香油', quantity: 3, unit: 'ml', note: '' },
      { key: 'i6', name: '盐', quantity: null, unit: '', note: '适量' }
    ],
    steps: [
      { text: '紫菜撕小片，鸡蛋打散备用。', minutes: 2, image: '' },
      { text: '水烧开，下紫菜和虾皮煮 2 分钟。', minutes: 3, image: '' },
      { text: '转小火，沿锅边细细淋入蛋液，静置 10 秒再轻轻推散，加盐和香油。', minutes: 3, image: '' }
    ],
    tips: '虾皮本身有咸味，放盐前先尝一下。'
  }
]

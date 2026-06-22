/**
 * init-department-tree — 一次性云函数，初始化四级部门树到 Config
 * 部署后通过 tcb fn invoke 执行一次
 */
const cloud = require('@cloudbase/node-sdk');

const DEPARTMENT_TREE = [{"id":"dept_001","name":"AI业务创新中心","level":1,"children":[{"id":"dept_002","name":"销售部","level":2,"children":[]}]},{"id":"dept_003","name":"EMT","level":1,"children":[]},{"id":"dept_004","name":"财务管理中心","level":1,"children":[{"id":"dept_005","name":"会计部","level":2,"children":[]},{"id":"dept_006","name":"预算分析部","level":2,"children":[]},{"id":"dept_007","name":"资金管理部","level":2,"children":[]}]},{"id":"dept_008","name":"法律合规中心","level":1,"children":[{"id":"dept_009","name":"法务部","level":2,"children":[]},{"id":"dept_010","name":"合规部","level":2,"children":[]}]},{"id":"dept_011","name":"顾问委员会","level":1,"children":[]},{"id":"dept_012","name":"加盟中心","level":1,"children":[{"id":"dept_013","name":"加盟教学部","level":2,"children":[{"id":"dept_014","name":"加盟教学二区","level":3,"children":[]},{"id":"dept_015","name":"加盟教学一区","level":3,"children":[]}]},{"id":"dept_016","name":"招商运营部","level":2,"children":[]}]},{"id":"dept_017","name":"教研中心","level":1,"children":[{"id":"dept_018","name":"产品研发部","level":2,"children":[]},{"id":"dept_019","name":"教学部","level":2,"children":[{"id":"dept_020","name":"华北教学区","level":3,"children":[]},{"id":"dept_021","name":"华东教学区","level":3,"children":[]},{"id":"dept_022","name":"华南二教学区","level":3,"children":[]},{"id":"dept_023","name":"华南一教学区","level":3,"children":[]},{"id":"dept_024","name":"华中教学区","level":3,"children":[]},{"id":"dept_025","name":"教学S区","level":3,"children":[]},{"id":"dept_026","name":"西南教学区","level":3,"children":[]}]},{"id":"dept_027","name":"教学运营部","level":2,"children":[]},{"id":"dept_028","name":"师资培训部","level":2,"children":[]}]},{"id":"dept_029","name":"人力资本运营中心","level":1,"children":[{"id":"dept_030","name":"企业文化与员工关系部","level":2,"children":[]},{"id":"dept_031","name":"区域人事","level":2,"children":[]},{"id":"dept_032","name":"人才发展部","level":2,"children":[]},{"id":"dept_033","name":"薪酬绩效与人事服务部","level":2,"children":[]},{"id":"dept_034","name":"行政采购部","level":2,"children":[]},{"id":"dept_035","name":"招聘部","level":2,"children":[]}]},{"id":"dept_036","name":"信息技术中心","level":1,"children":[{"id":"dept_037","name":"AI创新部","level":2,"children":[]},{"id":"dept_038","name":"产品项目部","level":2,"children":[]},{"id":"dept_039","name":"技术研发部","level":2,"children":[]},{"id":"dept_040","name":"数据运营部","level":2,"children":[]}]},{"id":"dept_041","name":"用户服务中心","level":1,"children":[{"id":"dept_042","name":"全国区域","level":2,"children":[{"id":"dept_043","name":"东南一区","level":3,"children":[{"id":"dept_044","name":"福州台江","level":4,"children":[]},{"id":"dept_045","name":"泉州丰泽","level":4,"children":[]},{"id":"dept_046","name":"厦门湖里","level":4,"children":[]},{"id":"dept_047","name":"温州鹿城","level":4,"children":[]}]},{"id":"dept_048","name":"华北二区","level":3,"children":[{"id":"dept_049","name":"济南高新","level":4,"children":[]},{"id":"dept_050","name":"济南市中","level":4,"children":[]},{"id":"dept_051","name":"青岛市南","level":4,"children":[]},{"id":"dept_052","name":"石家庄长安","level":4,"children":[]},{"id":"dept_053","name":"天津滨海","level":4,"children":[]},{"id":"dept_054","name":"天津和平","level":4,"children":[]}]},{"id":"dept_055","name":"华北一区","level":3,"children":[{"id":"dept_056","name":"北京丰台","level":4,"children":[]},{"id":"dept_057","name":"北京国贸","level":4,"children":[]},{"id":"dept_058","name":"北京海淀","level":4,"children":[]},{"id":"dept_059","name":"北京上地","level":4,"children":[]},{"id":"dept_060","name":"北京通州","level":4,"children":[]},{"id":"dept_061","name":"北京望京","level":4,"children":[]}]},{"id":"dept_062","name":"华南二区","level":3,"children":[{"id":"dept_063","name":"东莞南城","level":4,"children":[]},{"id":"dept_064","name":"广州白云","level":4,"children":[]},{"id":"dept_065","name":"广州番禺","level":4,"children":[]},{"id":"dept_066","name":"广州海珠","level":4,"children":[]},{"id":"dept_067","name":"广州天河","level":4,"children":[]}]},{"id":"dept_068","name":"华南一区","level":3,"children":[{"id":"dept_069","name":"佛山禅城","level":4,"children":[]},{"id":"dept_070","name":"深圳宝安","level":4,"children":[]},{"id":"dept_071","name":"深圳福田","level":4,"children":[]},{"id":"dept_072","name":"深圳罗湖","level":4,"children":[]},{"id":"dept_073","name":"深圳南山","level":4,"children":[]},{"id":"dept_074","name":"中山石岐","level":4,"children":[]},{"id":"dept_075","name":"珠海香洲","level":4,"children":[]}]},{"id":"dept_076","name":"华中二区","level":3,"children":[{"id":"dept_077","name":"南昌东湖","level":4,"children":[]},{"id":"dept_078","name":"武汉汉口","level":4,"children":[]},{"id":"dept_079","name":"武汉武昌","level":4,"children":[]},{"id":"dept_080","name":"西安未央","level":4,"children":[]},{"id":"dept_081","name":"西安雁塔","level":4,"children":[]}]},{"id":"dept_082","name":"华中三区","level":3,"children":[{"id":"dept_083","name":"杭州上城","level":4,"children":[]},{"id":"dept_084","name":"杭州西湖","level":4,"children":[]},{"id":"dept_085","name":"合肥滨湖","level":4,"children":[]},{"id":"dept_086","name":"合肥蜀山","level":4,"children":[]},{"id":"dept_087","name":"宁波海曙","level":4,"children":[]}]},{"id":"dept_088","name":"华中一区","level":3,"children":[{"id":"dept_089","name":"常州钟楼","level":4,"children":[]},{"id":"dept_090","name":"南京玄武","level":4,"children":[]},{"id":"dept_091","name":"南通崇川","level":4,"children":[]},{"id":"dept_092","name":"上海浦东","level":4,"children":[]},{"id":"dept_093","name":"上海莘庄","level":4,"children":[]},{"id":"dept_094","name":"上海杨浦","level":4,"children":[]},{"id":"dept_095","name":"上海长宁","level":4,"children":[]},{"id":"dept_096","name":"苏州园区","level":4,"children":[]},{"id":"dept_097","name":"无锡梁溪","level":4,"children":[]}]},{"id":"dept_098","name":"西南一区","level":3,"children":[{"id":"dept_099","name":"成都高新","level":4,"children":[]},{"id":"dept_100","name":"成都锦江","level":4,"children":[]},{"id":"dept_101","name":"昆明盘龙","level":4,"children":[]},{"id":"dept_102","name":"重庆九龙坡","level":4,"children":[]},{"id":"dept_103","name":"重庆两江","level":4,"children":[]}]},{"id":"dept_104","name":"长沙区","level":3,"children":[{"id":"dept_105","name":"长沙芙蓉","level":4,"children":[]},{"id":"dept_106","name":"长沙岳麓","level":4,"children":[]}]}]},{"id":"dept_107","name":"运营部","level":2,"children":[{"id":"dept_108","name":"服务运营组","level":3,"children":[]},{"id":"dept_109","name":"交付运营组","level":3,"children":[]},{"id":"dept_110","name":"培训运营组","level":3,"children":[]},{"id":"dept_111","name":"视觉运营组","level":3,"children":[]},{"id":"dept_112","name":"拓新营建组","level":3,"children":[]},{"id":"dept_113","name":"销售运营组","level":3,"children":[]}]}]},{"id":"dept_114","name":"用户增长中心","level":1,"children":[{"id":"dept_115","name":"TMK","level":2,"children":[]},{"id":"dept_116","name":"品牌部","level":2,"children":[]},{"id":"dept_117","name":"沙龙会销部","level":2,"children":[]},{"id":"dept_118","name":"市场推广部","level":2,"children":[]},{"id":"dept_119","name":"私域运营部","level":2,"children":[]},{"id":"dept_120","name":"直播部","level":2,"children":[]}]},{"id":"dept_121","name":"政府项目部","level":1,"children":[]}];

exports.main = async () => {
  const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV });
  const db = app.database();

  function flatten(nodes) {
    const names = [];
    for (const n of nodes) {
      names.push(n.name);
      if (n.children?.length) names.push(...flatten(n.children));
    }
    return names;
  }

  const flatList = flatten(DEPARTMENT_TREE);

  try {
    const existing = await db.collection('Config').doc('system').get().catch(() => ({ data: [] }));

    const doc = {
      departmentTree: DEPARTMENT_TREE,
      departments: flatList,
      updatedAt: new Date(),
    };

    if (existing?.data && existing.data.length > 0) {
      // 文档已存在 → 更新（保留其他字段）
      await db.collection('Config').doc('system').update(doc);
    } else {
      // 文档不存在 → 创建
      await db.collection('Config').add({ _id: 'system', ...doc, createdAt: new Date() });
    }

    // 同时确保 RecruitmentDemand 集合存在（客户端 SDK 无法自动创建集合）
    // 注意：不能先 query 再 add（集合不存在时 query 也报错），直接 add 即可触发自动创建
    try {
      await db.collection('RecruitmentDemand').add({
        _id: '_init_placeholder_',
        title: '__系统初始化__',
        status: 'deleted',
        ownerId: 'system',
        submittedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (e) {
      // 如 _id 重复说明集合已存在，忽略；其他错误抛出
      if (!e.message?.includes('duplicate') && !e.message?.includes('E11000')) {
        console.warn('[init-department-tree] 创建RecruitmentDemand集合失败:', e.message);
      }
    }

    return {
      success: true,
      message: '部门树初始化成功',
      stats: {
        totalDepartments: flatList.length,
      },
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

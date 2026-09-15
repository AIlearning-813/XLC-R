/**
 * CandidateForm.test.js — 候选人表单「重复候选人」提示与放行
 *
 * 背景（本次修复的 bug）：
 *   卢思颖导入徐哲湲时，系统提示「已存在该候选人，已阻止重复录入」，但她在候选人模块
 *   **搜不到**这条记录——因为候选人列表按归属过滤（见 candidate-listing.js），而查重是全库的。
 *   结果是：既禁止录入，又看不到已有记录，形成死结；而且那句指引
 *   「请到候选人模块查看已有记录」要求用户去做一件她做不到的事。
 *
 * 业务决定（方案乙）：不再阻断。改为提示「这条记录现在归属谁」，两位专员各自保留一份简历。
 *
 * 本测试锁定三件事：
 *   1. exact / high 两级都不再硬阻断 —— 勾选已知晓即可提交（死结已解开）
 *   2. 提示里必须写明当前归属人（ownerId，回退 createdBy，再回退「未知」）
 *   3. 旧文案（「已阻止重复录入」/「去候选人模块查看」）彻底消失，不能回潮
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import cloudbase from '../../services/cloudbase';

// ===== Mock CloudBase SDK（自动使用 __mocks__/cloudbase.js）=====
vi.mock('../../services/cloudbase');

// ===== 统一按管理员身份，避免 ownerFilter 影响岗位/需求取数 =====
vi.mock('../../stores/useAuthStore', () => ({
  useAuthStore: () => ({
    isAdmin: true,
    currentUsername: 'admin',
    userName: '管理员',
    userRole: 'admin',
    isLoggedIn: true,
  }),
}));

import CandidateForm from './CandidateForm.vue';

/** 岗位数据：isFormValid 需要「姓名 + 岗位」 */
const JOB = { _id: 'job1', title: '招聘专员', department: '人力资源部', status: 'active' };

/** 一个归属他人的高置信度重复：手机号完全相同，记录在刘滢滢名下 */
const DUP_OTHER_OWNER = {
  matchLevel: 'high',
  matchReason: '手机号完全相同',
  candidate: {
    _id: 'c-xuzhem',
    name: '徐哲湲',
    phone: '157****6697',
    ownerId: '刘滢滢',
  },
};

/** 挂载表单并等待 onMounted 的岗位/需求加载完成 */
async function mountForm(duplicates = []) {
  cloudbase.__setCollectionData('Job', [JOB]);
  const wrapper = mount(CandidateForm, {
    props: { duplicates, parseResult: {} },
  });
  await flushPromises();
  return wrapper;
}

/** 填最小可提交内容：姓名 + 岗位 */
async function fillValidForm(wrapper) {
  await wrapper.find('input[placeholder="请输入候选人姓名"]').setValue('徐哲漫');
  // 本表单共 5 个 select（需求/部门/岗位/来源/渠道），按「含 job1 选项」定位，不依赖顺序
  const jobSelect = wrapper
    .findAll('select')
    .find((s) => s.findAll('option').some((o) => o.element.value === 'job1'));
  expect(jobSelect, '未找到岗位下拉（Job mock 是否加载成功？）').toBeTruthy();
  await jobSelect.setValue('job1');
}

/** 「确认创建候选人」按钮 */
function submitBtn(wrapper) {
  return wrapper.findAll('button').find((b) => b.text().includes('确认创建候选人'));
}

/** 全选复选框里那个「已知晓」 */
function ackBox(wrapper) {
  return wrapper.find('.duplicate-checkbox');
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('CandidateForm — 重复候选人提示与放行', () => {
  describe('命中归属他人的强重复（exact / high）：提示归属，但不再阻断', () => {
    it('high（手机号完全相同）：提示里写明当前归属人，且勾选已知晓后可提交', async () => {
      const wrapper = await mountForm([DUP_OTHER_OWNER]);
      await fillValidForm(wrapper);

      // 归属人被明确写出——上传者知道该找谁对接
      const warning = wrapper.find('.duplicate-warning').text();
      expect(warning).toContain('刘滢滢');
      expect(warning).toContain('手机号或邮箱与已有候选人完全相同');
      // 列表项里也逐条标注归属
      expect(wrapper.find('.duplicate-list').text()).toContain('归属：刘滢滢');

      // 未勾选：不允许提交（提示仍然起作用）
      expect(submitBtn(wrapper).attributes('disabled')).toBeDefined();

      // 勾选已知晓：放行 —— 这就是原死结被解开的证据
      await ackBox(wrapper).setValue(true);
      expect(submitBtn(wrapper).attributes('disabled')).toBeUndefined();
    });

    it('exact（同一份简历文件）：同样可勾选放行，不再硬阻断', async () => {
      const wrapper = await mountForm([
        {
          matchLevel: 'exact',
          matchReason: '文件哈希完全相同',
          candidate: { _id: 'c2', name: '徐哲湲', ownerId: '刘滢滢' },
        },
      ]);
      await fillValidForm(wrapper);

      expect(wrapper.find('.duplicate-warning').text()).toContain('同一份简历文件已录入过');
      expect(submitBtn(wrapper).attributes('disabled')).toBeDefined();

      await ackBox(wrapper).setValue(true);
      expect(submitBtn(wrapper).attributes('disabled')).toBeUndefined();
    });

    it('旧文案彻底消失：不再宣称「已阻止重复录入」，也不再引导去一个搜不到的地方', async () => {
      const wrapper = await mountForm([DUP_OTHER_OWNER]);
      await fillValidForm(wrapper);

      const text = wrapper.text();
      expect(text).not.toContain('已阻止重复录入');
      expect(text).not.toContain('请到候选人模块查看已有记录');
      expect(text).not.toContain('去候选人模块查看');
      // 阻断区块的样式类也不应再出现在模板里
      expect(wrapper.find('.duplicate-blocked').exists()).toBe(false);
    });
  });

  describe('归属人的取法与汇总', () => {
    it('没有 ownerId 时回退到 createdBy', async () => {
      const wrapper = await mountForm([
        {
          matchLevel: 'high',
          matchReason: '邮箱完全相同',
          candidate: { _id: 'c3', name: '徐哲湲', createdBy: '王小明' },
        },
      ]);
      expect(wrapper.find('.duplicate-list').text()).toContain('归属：王小明');
    });

    it('ownerId 与 createdBy 都没有时显示「未知」，不显示空白', async () => {
      const wrapper = await mountForm([
        { matchLevel: 'medium', matchReason: '姓名相同', candidate: { _id: 'c4', name: '徐哲湲' } },
      ]);
      expect(wrapper.find('.duplicate-list').text()).toContain('归属：未知');
    });

    it('多条命中分属不同人时，顶部说明列出全部归属人且去重', async () => {
      const wrapper = await mountForm([
        DUP_OTHER_OWNER,
        {
          matchLevel: 'high',
          matchReason: '邮箱完全相同',
          candidate: { _id: 'c5', name: '徐哲湲', ownerId: '王小明' },
        },
        {
          matchLevel: 'medium',
          matchReason: '姓名相同且多维交叉',
          candidate: { _id: 'c6', name: '徐哲湲', ownerId: '刘滢滢' },   // 重复的归属人
        },
      ]);

      const desc = wrapper.find('.duplicate-desc').text();
      expect(desc).toContain('刘滢滢');
      expect(desc).toContain('王小明');
      // 去重：刘滢滢 出现两次命中，但汇总里只列一次
      expect(desc.match(/刘滢滢/g)).toHaveLength(1);
    });

    it('所有命中都查不到归属人时，顶部不输出空的「当前归属：」', async () => {
      const wrapper = await mountForm([
        { matchLevel: 'medium', matchReason: '姓名相同', candidate: { _id: 'c7', name: '徐哲湲' } },
      ]);
      const desc = wrapper.find('.duplicate-desc').text();
      expect(desc).not.toContain('当前归属：');
      // 但逐条列表仍标注「未知」，不让信息缺失变成沉默
      expect(wrapper.find('.duplicate-list').text()).toContain('归属：未知');
    });
  });

  describe('回归：没有重复命中时不受影响', () => {
    it('不渲染重复告警，提交只受「姓名 + 岗位」约束', async () => {
      const wrapper = await mountForm([]);
      expect(wrapper.find('.duplicate-warning').exists()).toBe(false);

      // 表单未填全 → 不可提交
      expect(submitBtn(wrapper).attributes('disabled')).toBeDefined();

      // 填全 → 可提交，无需任何「已知晓」
      await fillValidForm(wrapper);
      expect(submitBtn(wrapper).attributes('disabled')).toBeUndefined();
    });

    it('medium（同名多维交叉）仍走「勾选已知晓」放行', async () => {
      const wrapper = await mountForm([
        {
          matchLevel: 'medium',
          matchReason: '姓名相同且多维度交叉',
          candidate: { _id: 'c8', name: '徐哲湲', ownerId: '刘滢滢' },
        },
      ]);
      await fillValidForm(wrapper);
      expect(submitBtn(wrapper).attributes('disabled')).toBeDefined();

      await ackBox(wrapper).setValue(true);
      expect(submitBtn(wrapper).attributes('disabled')).toBeUndefined();
    });
  });
});

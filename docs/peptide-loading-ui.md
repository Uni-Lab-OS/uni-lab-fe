# 人工入库公共干预 UI（2026-09-09）

## 当前接入

人工入库复用现有常驻 WorkflowInterventions 宿主，不新增库存状态或独立设备控制状态机。宿主在 readiness gate 之外；页面切换、断线和最小化均保留未决事项。多个入库与设备异常共用事项选择，不弹出相互遮挡的固定窗口。

公共合同：`meta_data.loading={schema_version:1,request_uuid,revision,rows}`，其中 revision 为整数。每行使用仪器、库位稳定引用及物料显示投影。已有物料必须提供稳定 id；计划物料不接受伪造实例 id。数量、单位、目标可用性来自服务冻结快照。

确认仅通过现有公共 decisions API，option=`confirm_loading`，result=`{request_uuid,revision}`；不发送任意材料或库位 UUID。外层干预 revision 与原 Idempotency-Key 保持不变，不确定重投复用同一 body。已选择/accepted 仍等待权威库存更新，只有 superseded 才移除。格式不兼容的 loading 不允许回退通用确认按钮。REST 读取失败后禁止提交，权威重读成功才恢复。

窗口提供最小化与恢复，没有关闭或自动确认。离线、提交中、已提交、无可用确认合同、明细为空、数量无效和库位不可用均禁止确认。宽高滑杆可用键盘调整；localStorage 仅记录视口比例，恢复时限制到当前视口。损坏或不可读取偏好不影响干预；不保存业务响应或用户选择。

本批单独附带真实 GUI 反馈的日志筛选布局修复：级别与类别各自分行，标签与 checkbox chip 不折字，保留多选；最近条数与复制控制允许换行。

## 验证

工作目录 `C:/Users/yxzjr/Documents/Uni-Lab-Core/uni-lab-fe`：

```powershell
pnpm --filter @unilab/services --filter @unilab/workflow-editor test *> .local-loading-tests.log
pnpm --filter @unilab/workbench-theia test *> .local-loading-log-layout-tests.log
pnpm --filter @unilab/services --filter @unilab/workflow-editor --filter @unilab/workbench-theia --filter @unilab/kernel-web typecheck *> .local-loading-typecheck.log
```

services 230、workflow-editor 463 测试通过。Theia 140 测试通过；services、workflow-editor、workbench-theia、kernel-web 四包类型检查全部通过（exit 0）。静态渲染与纯规则测试不等于交互端到端验证。后端公共请求生产链及实际入库事务仍由主会话联调；待再次构建桌面后做真实入库 UI 验收，当前正在运行的桌面包不含本次 R4 接入。


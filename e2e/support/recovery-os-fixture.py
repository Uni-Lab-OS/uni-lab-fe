from pathlib import Path
import argparse
import json
import tempfile
import uvicorn
from tests.scheduler_core.conftest import build_core_runtime
from unilabos.app.workflow_api import create_workflow_app
from unilabos.workflow.service import WorkflowService

parser = argparse.ArgumentParser(description='启动隔离的真实 OS 恢复接口测试实例（仅模拟设备）')
parser.add_argument('--port', type=int, default=49871)
parser.add_argument('--manifest', type=Path, default=Path('/tmp/unilab-recovery-fixture.json'))
args = parser.parse_args()
root = Path(tempfile.mkdtemp(prefix='unilab-recovery-'))
runtime = build_core_runtime(root)
first, approve_job = runtime.submit_manual(task_name='recovery-approve', device_id='reactor-a')
second, reject_job = runtime.submit_manual(task_name='recovery-reject', device_id='reactor-b')
failed = runtime.submit(task_name='recovery-error', devices=['warehouse-a'])
service = WorkflowService(runtime.workflow_store, task_scheduler_bridge=runtime.bridge)
error = service.error_handling.control.report_error(failed['jobs'][0]['uuid'], phase='execution', message='隔离验证：设备动作异常')
args.manifest.write_text(json.dumps({'approve_job': approve_job, 'reject_job': reject_job, 'error_task': failed['task']['uuid'], 'decision': error['decision_id'], 'root': str(root)}))
try:
    uvicorn.run(create_workflow_app(service), host='127.0.0.1', port=args.port, log_level='warning')
finally:
    runtime.close()

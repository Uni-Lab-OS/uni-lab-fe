"""用当前 Uni-Lab-OS Edge 客户端连接 Backend 与 SZLab PLC 联调夹具。

该启动器只用于真实联调。当前 OS Edge 注册仍发送旧的 barcode-only 设备描述，
因此这里补充 Backend 要求的 Material UUID 与实例动作能力；产品启动路径不依赖此文件。
"""

from __future__ import annotations

import os
from typing import Any

from unilabos.app.communication import CommunicationClientFactory
from unilabos.app.edge_control.client import EdgeControlClient


PLC_MATERIAL_UUID = os.environ.get("UNILAB_PLC_MATERIAL_UUID", "").strip()
PLC_BARCODE = os.environ.get(
    "UNILAB_PLC_BARCODE",
    "PLC-SIM-EDGE-LOCAL",
).strip()

if not PLC_MATERIAL_UUID:
    raise RuntimeError("UNILAB_PLC_MATERIAL_UUID is required")


def _create_plc_edge_client(
    _factory: type[CommunicationClientFactory],
) -> EdgeControlClient:
    client = EdgeControlClient()

    def registration_devices() -> list[dict[str, Any]]:
        return [
            {
                "local_id": "szlab_poly_plc",
                "name": "SZLab PLC 仿真 Edge",
                "material_uuid": PLC_MATERIAL_UUID,
                "barcode": PLC_BARCODE,
                "actions": [
                    {
                        "name": "check_opcua_connection",
                        "type": "UniLabJsonCommand",
                    },
                    {
                        "name": "write_variable_action",
                        "type": "UniLabJsonCommand",
                    },
                ],
            }
        ]

    client._registration_devices = registration_devices  # type: ignore[method-assign]
    return client


CommunicationClientFactory._create_websocket_client = classmethod(  # type: ignore[method-assign]
    _create_plc_edge_client
)

from unilabos.app.main import main


if __name__ == "__main__":
    main()

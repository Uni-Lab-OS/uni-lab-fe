import {
  Alert,
  Button,
  Descriptions,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Select,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import type { Reagent, ReagentInfo } from "@unilab-fe/core";
import { useBackend } from "../../app/BackendProvider";

export type ReagentModalState =
  | { readonly type: "create-info" }
  | { readonly type: "create-inventory"; readonly info?: ReagentInfo }
  | { readonly type: "catalog-detail"; readonly info: ReagentInfo }
  | { readonly type: "history"; readonly reagent: Reagent }
  | { readonly type: "edit-inventory"; readonly reagent: Reagent };

export function ReagentModal({
  state,
  onClose,
  onSaved,
}: {
  state: ReagentModalState | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  if (!state) return null;
  if (state.type === "catalog-detail")
    return <CatalogDetail info={state.info} onClose={onClose} />;
  if (state.type === "history")
    return <HistoryModal reagent={state.reagent} onClose={onClose} />;
  return <MutationModal state={state} onClose={onClose} onSaved={onSaved} />;
}

function CatalogDetail({
  info,
  onClose,
}: {
  info: ReagentInfo;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      title="试剂目录详情"
      footer={<Button onClick={onClose}>关闭</Button>}
      onCancel={onClose}
    >
      <Descriptions column={1} size="small" colon={false}>
        <Descriptions.Item label="名称">{info.name}</Descriptions.Item>
        <Descriptions.Item label="英文名">
          {info.nameEn ?? "未提供"}
        </Descriptions.Item>
        <Descriptions.Item label="CAS 号">
          {info.cas ?? "未提供"}
        </Descriptions.Item>
        <Descriptions.Item label="分子式">
          {info.molecularFormula ?? "未提供"}
        </Descriptions.Item>
        <Descriptions.Item label="物态">{info.physicalState}</Descriptions.Item>
        <Descriptions.Item label="分子量">
          {info.molecularWeight ?? "未提供"}
        </Descriptions.Item>
        <Descriptions.Item label="描述">
          {info.description ?? "未提供"}
        </Descriptions.Item>
      </Descriptions>
    </Modal>
  );
}

function HistoryModal({
  reagent,
  onClose,
}: {
  reagent: Reagent;
  onClose: () => void;
}) {
  const { backend } = useBackend();
  const [history, setHistory] = useState<Awaited<
    ReturnType<typeof backend.services.inventory.listReagentHistory>
  > | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    if (!backend.services.getCapabilityStatus("inventory.readReagentHistory").available) {
      setError(new Error("当前端点未开放库存历史读取能力"));
      setLoading(false);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    void backend.services.inventory
      .listReagentHistory(reagent.materialUuid)
      .then((value) => {
        if (active) setHistory(value);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause : new Error("读取历史失败"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [backend, reagent.materialUuid]);
  return (
    <Modal
      open
      title={`库存历史 · ${reagent.name}`}
      footer={<Button onClick={onClose}>关闭</Button>}
      onCancel={onClose}
    >
      {loading ? (
        <Typography.Text type="secondary">
          正在读取不可变库存台账...
        </Typography.Text>
      ) : error ? (
        <Alert
          type="error"
          showIcon
          message="历史读取失败"
          description={error.message}
        />
      ) : history?.items.length ? (
        <List
          className="history-list"
          dataSource={[...history.items]}
          renderItem={(item) => (
            <List.Item>
              <div>
                <strong>{item.eventType}</strong>
                <span>
                  {item.quantityDelta == null
                    ? "数量未提供"
                    : `${item.quantityDelta} ${item.quantityUnit ?? ""}`}
                </span>
              </div>
              <small>
                {item.recordedAt} / {item.operatorType}
              </small>
            </List.Item>
          )}
        />
      ) : (
        <Typography.Text type="secondary">暂无库存变更记录</Typography.Text>
      )}
    </Modal>
  );
}

function MutationModal({
  state,
  onClose,
  onSaved,
}: {
  state: Exclude<ReagentModalState, { type: "catalog-detail" | "history" }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { backend } = useBackend();
  const [form] = Form.useForm<Record<string, unknown>>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isInfo = state.type === "create-info";
  const title = isInfo
    ? "新增试剂目录"
    : state.type === "create-inventory"
      ? "录入试剂库存"
      : "编辑试剂库存";
  const submit = async (values: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    try {
      const capability = state.type === "create-info"
        ? "reagentInfo.create"
        : state.type === "create-inventory"
          ? "inventory.createReagent"
          : "inventory.updateReagent";
      if (!backend.services.getCapabilityStatus(capability).available) {
        throw new Error("当前端点未开放此项试剂写入能力");
      }
      if (state.type === "create-info")
        await backend.services.inventory.createReagentInfo({
          name: String(values.name),
          nameEn: String(values.nameEn || "") || undefined,
          aliases: [],
          cas: String(values.cas || "") || undefined,
          physicalState: values.physicalState as
            | "solid"
            | "liquid"
            | "gas"
            | "other"
            | "unknown",
          molecularFormula: String(values.molecularFormula || "") || undefined,
          description: String(values.description || "") || undefined,
        });
      else if (state.type === "create-inventory")
        await backend.services.inventory.createReagent({
          materialId: String(values.materialId),
          reagentInfoId:
            state.info?.reagentInfoUuid ?? String(values.reagentInfoId),
          quantity: Number(values.quantity),
          quantityUnit: String(values.quantityUnit),
          physicalState: values.physicalState as
            | "solid"
            | "liquid"
            | "gas"
            | "other"
            | "unknown",
          description: String(values.description || "") || undefined,
        });
      else
        await backend.services.inventory.updateReagent({
          id: state.reagent.reagentUuid,
          quantity: Number(values.quantity),
          quantityUnit: String(values.quantityUnit),
          expectedRevision: state.reagent.revision ?? 0,
          concentrationValue:
            values.concentrationValue == null
              ? undefined
              : Number(values.concentrationValue),
          concentrationUnit:
            String(values.concentrationUnit || "") || undefined,
          description: String(values.description || "") || undefined,
        });
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("写入失败"));
    } finally {
      setLoading(false);
    }
  };
  return (
    <Modal
      open
      className="reagent-mutation-modal"
      width={640}
      title={title}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      <Form
        form={form}
        className="reagent-mutation-form"
        layout="vertical"
        initialValues={{
          reagentInfoId:
            state.type === "create-inventory"
              ? state.info?.reagentInfoUuid
              : undefined,
          quantity:
            state.type === "edit-inventory"
              ? state.reagent.quantity
              : undefined,
          quantityUnit:
            state.type === "edit-inventory" ? state.reagent.quantityUnit : "mL",
          materialId:
            state.type === "edit-inventory"
              ? state.reagent.materialUuid
              : undefined,
          physicalState: "liquid",
        }}
        onFinish={submit}
      >
        <div className="reagent-form-grid">
          {isInfo ? (
            <>
            <Form.Item
              label="名称"
              name="name"
              rules={[{ required: true, message: "请输入试剂名称" }]}
            >
              <Input />
            </Form.Item>
            <Form.Item label="英文名" name="nameEn">
              <Input />
            </Form.Item>
            <Form.Item label="CAS 号" name="cas">
              <Input />
            </Form.Item>
            <Form.Item label="分子式" name="molecularFormula">
              <Input />
            </Form.Item>
            <Form.Item
              label="物态"
              name="physicalState"
              rules={[{ required: true, message: "请选择物态" }]}
            >
              <Select
                options={[
                  { value: "solid", label: "固体" },
                  { value: "liquid", label: "液体" },
                  { value: "gas", label: "气体" },
                  { value: "other", label: "其他" },
                ]}
              />
            </Form.Item>
            <Form.Item
              className="reagent-form-field--wide"
              label="描述"
              name="description"
            >
              <Input.TextArea rows={3} />
            </Form.Item>
            </>
          ) : (
            <>
            <Form.Item
              label="容器物料 UUID"
              name="materialId"
              rules={[{ required: true, message: "请输入承载试剂的物料 UUID" }]}
            >
              <Input disabled={state.type === "edit-inventory"} />
            </Form.Item>
            <Form.Item
              label="试剂身份 UUID"
              name="reagentInfoId"
              rules={[
                {
                  required: !("info" in state && state.info),
                  message: "请输入试剂身份 UUID",
                },
              ]}
            >
              <Input
                disabled={
                  state.type === "create-inventory" && Boolean(state.info)
                }
              />
            </Form.Item>
            <Form.Item
              label="库存量"
              name="quantity"
              rules={[{ required: true, message: "请输入库存量" }]}
            >
              <InputNumber className="full-input" min={0} />
            </Form.Item>
            <Form.Item
              label="单位"
              name="quantityUnit"
              rules={[{ required: true, message: "请输入单位" }]}
            >
              <Input />
            </Form.Item>
            {state.type !== "edit-inventory" && (
              <Form.Item label="物态" name="physicalState">
                <Select
                  options={[
                    { value: "solid", label: "固体" },
                    { value: "liquid", label: "液体" },
                    { value: "gas", label: "气体" },
                    { value: "other", label: "其他" },
                  ]}
                />
              </Form.Item>
            )}
            <Form.Item
              className="reagent-form-field--wide"
              label="说明"
              name="description"
            >
              <Input.TextArea rows={3} />
            </Form.Item>
            </>
          )}
          {error && (
            <Alert
              className="form-error reagent-form-field--wide"
              type="error"
              showIcon
              message="提交失败"
              description={error.message}
            />
          )}
          <div className="modal-actions reagent-form-field--wide">
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" htmlType="submit" loading={loading}>
              保存
            </Button>
          </div>
        </div>
      </Form>
    </Modal>
  );
}

import { Fragment, useState } from 'react'
import { Alert, Avatar, Badge, Breadcrumb, Button, Calendar, Card, Carousel, Checkbox, Collapse, DatePicker, Descriptions, Divider, Drawer, Dropdown, Form, Input, List, Menu, Modal, Pagination, Popconfirm, Popover, Progress, Radio, Rate, Result, Segmented, Select, Skeleton, Slider, Space, Spin, Steps, Switch, Table, Tabs, Tag, TimePicker, Tooltip, Transfer, Tree, TreeSelect, Typography, Upload } from 'antd'
import { EmptyState } from '@unilab/design-v2'
import type { ComponentSpec } from './componentRegistry'

const Panel = ({ children }: { children: React.ReactNode }): React.JSX.Element => <div className="demo-stack">{children}</div>

const resetAnswer = "Click on 'Forgot Password' on the login page, enter your email address, and we'll send you a link to reset your password. The link will expire in 24 hours."
const billingAnswer = 'We offer monthly and annual subscription plans. Billing is charged at the beginning of each cycle, and you can cancel anytime. All plans include automatic backups, 24/7 support, and unlimited team members.'

type AccordionItem = { key: string; label: string; children?: string; disabled?: boolean }

const resetItems: AccordionItem[] = [
  { key: 'reset', label: 'How do I reset my password?', children: resetAnswer },
  { key: 'plan', label: 'Can I change my subscription plan?' },
  { key: 'payment', label: 'What payment methods do you accept?' },
]

const generalItems: AccordionItem[] = [
  { key: 'billing', label: 'How does billing work?', children: billingAnswer },
  { key: 'security', label: 'Is my data secure?' },
  { key: 'integrations', label: 'What integrations do you support?' },
  { key: 'enterprise', label: 'What are the key considerations when implementing a comprehensive enterprise-level authentication system?' },
]

type AlertScene = {
  key: string
  type: 'default' | 'error' | 'success' | 'info' | 'warning'
  title: string
  description: string
  showIcon?: boolean
  action?: string
}

const alertScenes: AlertScene[] = [
  { key: 'default-icon', type: 'default', title: 'Alert Title', description: 'This is an alert description.' },
  { key: 'default-icon-2', type: 'default', title: 'Alert Title', description: 'This is an alert description.' },
  { key: 'without-icon', type: 'default', title: 'Alert Title', description: 'This is an alert description.', showIcon: false },
  { key: 'default-icon-3', type: 'default', title: 'Alert Title', description: 'This is an alert description.' },
  { key: 'default-icon-4', type: 'default', title: 'Alert Title', description: 'This is an alert description.' },
  { key: 'default-icon-5', type: 'default', title: 'Alert Title', description: 'This is an alert description.' },
  { key: 'error', type: 'error', title: 'Alert Title', description: 'This is an alert description.' },
  { key: 'error-2', type: 'error', title: 'Alert Title', description: 'This is an alert description.' },
  { key: 'undo', type: 'default', title: 'Alert Title', description: 'This is an alert description.', action: 'Undo' },
  { key: 'payment', type: 'success', title: 'Payment successful', description: 'Your payment of $129.99 has been processed. A receipt has been sent to your email address.' },
  { key: 'feature', type: 'info', title: 'New feature available', description: "We've added dark mode support. You can enable it in your account settings." },
  { key: 'enable', type: 'default', title: 'Alert Title', description: 'This is an alert description.', action: 'Enable' },
  { key: 'expiry', type: 'warning', title: 'Your subscription will expire in 3 days.', description: 'Please renew now to avoid service interruptions or upgrade to a paid plan to continue using the service.' },
]

function FidelityAlert({ scene }: { scene: AlertScene }): React.JSX.Element {
  return <Alert
    className={`alert-fidelity-card alert-fidelity-${scene.type}`}
    type={scene.type === 'default' ? 'info' : scene.type}
    showIcon={scene.showIcon !== false}
    message={scene.title}
    description={scene.description}
    action={scene.action ? <button type="button" className="alert-fidelity-action">{scene.action}</button> : undefined}
  />
}

function AlertThemePreview(): React.JSX.Element {
  return <section className="alert-fidelity-theme" aria-label="alert examples for current theme">
    {alertScenes.map((scene, index) => <Fragment key={scene.key}>
      <FidelityAlert scene={scene} />
      {index < alertScenes.length - 1 ? <span className="alert-fidelity-divider" aria-hidden /> : null}
    </Fragment>)}
  </section>
}

function AlertDemo(): React.JSX.Element {
  return <div className="alert-fidelity-scenes"><AlertThemePreview /></div>
}

type AlertDialogSize = 'default' | 'sm'

function AlertDialogCard({ size, destructive }: { size: AlertDialogSize; destructive: boolean }): React.JSX.Element {
  return <article className={`alert-dialog-card alert-dialog-card-${size}${destructive ? ' alert-dialog-card-destructive' : ''}`}>
    <div className="alert-dialog-body">
      <div className="alert-dialog-icon" aria-hidden>☺</div>
      <div className="alert-dialog-copy">
        <h3>Are you absolutely sure?</h3>
        <p>This action cannot be undone. This will permanently delete your account from our servers.</p>
      </div>
    </div>
    <div className="alert-dialog-footer">
      <Button className="alert-dialog-cancel">Cancel</Button>
      <Button className="alert-dialog-continue">Continue</Button>
    </div>
  </article>
}

function AlertDialogThemePreview(): React.JSX.Element {
  return <section className="alert-dialog-theme" aria-label="alert dialog variants for current theme">
    <div className="alert-dialog-theme-heading"><span>Alert Dialog</span><span>Size × Destructive</span></div>
    <div className="alert-dialog-grid">
      <AlertDialogCard size="default" destructive={false} />
      <AlertDialogCard size="default" destructive />
      <AlertDialogCard size="sm" destructive={false} />
      <AlertDialogCard size="sm" destructive />
    </div>
  </section>
}

function AlertDialogDemo(): React.JSX.Element {
  return <div className="alert-dialog-scenes"><AlertDialogThemePreview /></div>
}

const aspectRatios = [
  '1 / 1', '4 / 3', '3 / 4', '5 / 4', '4 / 5', '3 / 2', '2 / 3', '16 / 10', '10 / 16',
  '16 / 9', '9 / 16', '2 / 1', '1 / 2', '1.618 / 1', '1 / 1.618', '21 / 9', '9 / 21',
]

function AspectRatioImage({ ratio, labelled = false }: { ratio: string; labelled?: boolean }): React.JSX.Element {
  return <figure className={`aspect-ratio-fidelity-item${labelled ? ' aspect-ratio-fidelity-item-labelled' : ''}`}>
    <div className="aspect-ratio-fidelity-image" style={{ aspectRatio: ratio }} aria-label={`Aspect Ratio ${ratio}`} />
    {labelled ? <figcaption>{ratio}</figcaption> : null}
  </figure>
}

function AspectRatioThemePreview(): React.JSX.Element {
  return <section className="aspect-ratio-fidelity-theme" aria-label="aspect ratio examples for current theme">
    <div className="aspect-ratio-fidelity-featured">
      <AspectRatioImage ratio="1 / 1" />
      <AspectRatioImage ratio="4 / 3" />
    </div>
  </section>
}

function AspectRatioDemo(): React.JSX.Element {
  return <div className="aspect-ratio-fidelity-scenes">
    <AspectRatioThemePreview />
    <section className="aspect-ratio-fidelity-gallery" aria-label="Aspect Ratio ratio variants">
      {aspectRatios.map((ratio) => <AspectRatioImage key={ratio} ratio={ratio} labelled />)}
    </section>
  </div>
}

function AvatarFidelityDemo(): React.JSX.Element {
  const sizeRows = [{ label: 'xl', value: 64 }, { label: 'lg', value: 40 }, { label: 'default', value: 32 }, { label: 'sm', value: 24 }, { label: 'xs', value: 16 }]
  const imageSource = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"%3E%3Cdefs%3E%3ClinearGradient id="g" x1="0" x2="1" y1="0" y2="1"%3E%3Cstop stop-color="%239254DE"/%3E%3Cstop offset="1" stop-color="%233C49DD"/%3E%3C/linearGradient%3E%3C/defs%3E%3Ccircle cx="32" cy="32" r="32" fill="url(%23g)"/%3E%3Ccircle cx="32" cy="25" r="10" fill="white" fill-opacity=".9"/%3E%3Cpath d="M14 54c3-12 11-17 18-17s15 5 18 17" fill="white" fill-opacity=".9"/%3E%3C/svg%3E'
  return <div className="avatar-fidelity-card">
    <div className="avatar-fidelity-matrix" role="table" aria-label="Avatar type and size variants">
      <span className="avatar-fidelity-corner">Size / Type</span><span className="component-label">Image</span><span className="component-label">Fallback</span><span className="component-label">Icon</span>
      {sizeRows.map(({ label, value }) => <Fragment key={label}>
        <span className="component-label">{label}</span>
        <Avatar size={value} src={imageSource} />
        <Avatar size={value}>CN</Avatar>
        <Avatar size={value}>◌</Avatar>
      </Fragment>)}
    </div>
    <div className="avatar-fidelity-note"><span className="component-label">Fallback Text / CN · Show Badge / False · IconPlaceholder</span><Avatar size={24}>?</Avatar><Avatar size={32}>?</Avatar><Avatar size={40}>?</Avatar></div>
  </div>
}

function BreadcrumbFidelityDemo(): React.JSX.Element {
  const rows = [
    { label: 'Size / md · Items (md)', className: 'breadcrumb-fidelity-md', items: [{ title: 'Home' }, { title: 'Components' }, { title: 'Design system' }, { title: 'Breadcrumb' }] },
    { label: 'Size / sm · Items (sm)', className: 'breadcrumb-fidelity-sm', items: [{ title: 'Home' }, { title: '...' }, { title: <Typography.Text strong>Breadcrumb</Typography.Text> }] },
  ]
  return <div className="breadcrumb-fidelity-card">{rows.map((row) => <div className={`breadcrumb-fidelity-row ${row.className}`} key={row.label}><span className="component-label">{row.label}</span><Breadcrumb items={row.items} /></div>)}<div className="breadcrumb-fidelity-footnote"><span className="component-label">State / Dropdown · Current · Focus</span><Breadcrumb items={[{ title: 'Home' }, { title: 'Components', menu: { items: [{ key: 'a', label: 'Accordion' }, { key: 'b', label: 'Badge' }] } }, { title: 'Breadcrumb' }]} /></div></div>
}

function ButtonGroupFidelityDemo(): React.JSX.Element {
  const buttons = ['Outline', 'Default', 'Secondary', 'Outline', 'Default', 'Secondary']
  return <div className="button-group-fidelity-grid">
    <div className="component-stack"><span className="component-label">Orientation / Horizontal · Items 6</span><Space.Compact>{buttons.map((label, index) => <Button key={`${label}-${index}`} type={label === 'Default' ? 'primary' : undefined} className={label === 'Secondary' ? 'button-group-secondary' : undefined}>{label}</Button>)}</Space.Compact></div>
    <div className="component-stack"><span className="component-label">Orientation / Vertical · Items 6</span><Space.Compact direction="vertical">{buttons.map((label, index) => <Button key={`${label}-${index}`} type={label === 'Default' ? 'primary' : undefined} className={label === 'Secondary' ? 'button-group-secondary' : undefined}>{label}</Button>)}</Space.Compact></div>
  </div>
}

function CalendarFidelityDemo(): React.JSX.Element {
  return <div className="calendar-fidelity-grid">
    <div className="component-stack"><span className="component-label">Week Numbers / Custom Cell</span><Calendar fullscreen={false} showWeek /></div>
    <div className="component-stack"><span className="component-label">Date and Time Picker / Presets</span><DatePicker placeholder="Select date" /><TimePicker format="HH:mm" placeholder="Select time" /><Space wrap><Button size="small">Today</Button><Button size="small">Last 7 days</Button><Button size="small">This month</Button></Space></div>
  </div>
}

function CardFidelityDemo(): React.JSX.Element {
  return <div className="card-fidelity-grid">
    <Card title="Title Text" className="card-fidelity-main"><Typography.Paragraph type="secondary">This is a card description.</Typography.Paragraph><List size="small" split dataSource={['Card Content item 01', 'Card Content item 02']} renderItem={(item) => <List.Item>{item}</List.Item>} /><div className="card-fidelity-footer"><Button type="link" size="small">Footer item 01</Button><Button type="link" size="small">Footer item 02</Button></div></Card>
    <Card size="small" title="Small Card">Size sm / Show Image false / Card Header true.</Card>
    <Card bordered={false}><Typography.Text type="secondary">Show Action false / Swap Action Button.</Typography.Text></Card>
  </div>
}

function CarouselFidelityDemo(): React.JSX.Element {
  const slides = Array.from({ length: 5 }, (_, index) => <div key={index}><div className="carousel-panel">CarouselItem {String(index + 1).padStart(2, '0')}</div></div>)
  return <div className="carousel-fidelity-grid"><div className="component-stack"><span className="component-label">Orientation / Horizontal · Breakpoint lg</span><Carousel autoplay dots arrows className="fidelity-carousel">{slides}</Carousel></div><div className="component-stack"><span className="component-label">Orientation / Vertical · Breakpoint sm</span><Carousel vertical dots className="fidelity-carousel fidelity-carousel-vertical">{slides}</Carousel></div></div>
}

function FidelityAccordion({ items, activeKey, disabledKey, bordered = false }: { items: AccordionItem[]; activeKey: string; disabledKey?: string; bordered?: boolean }): React.JSX.Element {
  const resolvedItems = items.map((item) => ({ ...item, disabled: item.key === disabledKey || item.disabled }))
  return <Collapse
    className={`accordion-fidelity ${bordered ? 'accordion-fidelity-bordered' : 'accordion-fidelity-borderless'}`}
    bordered={false}
    expandIconPosition="end"
    defaultActiveKey={[activeKey]}
    expandIcon={({ isActive }) => <span className={`accordion-chevron${isActive ? ' is-active' : ''}`} aria-hidden />}
    items={resolvedItems}
  />
}

function AccordionCard({ title, description, items, activeKey }: { title: string; description?: string; items: AccordionItem[]; activeKey: string }): React.JSX.Element {
  return <section className="accordion-fidelity-card">
    <div className="accordion-fidelity-card-heading">
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
    </div>
    <FidelityAccordion items={items} activeKey={activeKey} bordered />
  </section>
}

function AccordionDemo(): React.JSX.Element {
  return <div className="accordion-fidelity-scenes">
    <section className="accordion-fidelity-scene" aria-label="Borderless accordion">
      <FidelityAccordion items={resetItems} activeKey="reset" />
    </section>
    <span className="accordion-divider" aria-hidden />
    <section className="accordion-fidelity-scene" aria-label="Borderless accordion with disabled item">
      <FidelityAccordion items={resetItems} activeKey="reset" disabledKey="plan" />
    </section>
    <span className="accordion-divider" aria-hidden />
    <AccordionCard title="General" description="Common questions about your workspace and account." items={generalItems} activeKey="billing" />
    <span className="accordion-divider" aria-hidden />
    <AccordionCard title="Subscription & Billing" description="Common questions about your account, plans, payments and cancellations." items={resetItems} activeKey="reset" />
  </div>
}

function OverlayDemo({ name }: { name: string }): React.JSX.Element {
  const [modalOpen, setModalOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  if (name === 'Drawer' || name === 'Sheet') {
    if (name === 'Drawer') return <div className="drawer-fidelity-grid"><div className="drawer-fidelity-preview"><Typography.Text strong>Drawer / 4 directions</Typography.Text><div className="drawer-direction-grid">{['bottom', 'top', 'right', 'left'].map((direction) => <span key={direction}>{direction}</span>)}</div><Button onClick={() => setDrawerOpen(true)}>打开 Drawer</Button><Drawer title="Title Text" placement="right" open={drawerOpen} onClose={() => setDrawerOpen(false)} extra={<Button type="primary">Action</Button>}>This is a drawer description.<Divider /><Typography.Text>Drawer Content item 01</Typography.Text><Typography.Text>Drawer Content item 02</Typography.Text></Drawer></div></div>
    return <div className="sheet-fidelity-grid"><div><Typography.Text strong>Sheet / directions</Typography.Text><Space wrap><Tag>default</Tag><Tag>left</Tag><Tag>right</Tag><Tag>bottom</Tag></Space><Button onClick={() => setDrawerOpen(true)}>打开 Sheet</Button></div><Drawer title="Sheet" placement="bottom" open={drawerOpen} onClose={() => setDrawerOpen(false)}>次级任务和上下文信息。<Divider /><Button type="primary">Save</Button></Drawer></div>
  }
  if (name === 'Dialog' || name === 'Alert Dialog') {
    if (name === 'Dialog') return <div className="dialog-fidelity-grid">{['default 384', 'confirm 384', 'destructive 320', 'loading 320'].map((variant) => <div className={`dialog-fidelity-card${variant.includes('destructive') ? ' is-destructive' : ''}`} key={variant}><Typography.Text strong>Dialog title</Typography.Text><Typography.Text type="secondary">This is a dialog description.</Typography.Text><div className="dialog-fidelity-actions"><Button size="small">Cancel</Button><Button size="small" type={variant.includes('destructive') ? 'primary' : 'primary'} danger={variant.includes('destructive')} loading={variant.includes('loading')}>Continue</Button></div><Typography.Text type="secondary">{variant}</Typography.Text></div>)}</div>
    return <><Button type="primary" onClick={() => setModalOpen(true)}>打开 {name}</Button><Modal title={name} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => setModalOpen(false)}>使用 elevated surface、border 和 focus token。</Modal></>
  }
  if (name === 'Dropdown Menu' || name === 'Context Menu') {
    if (name === 'Context Menu') return <Menu className="context-menu-fidelity" selectable items={[{ key: 'edit', label: 'Edit' }, { key: 'copy', label: 'Copy' }, { type: 'divider' }, { key: 'sub', label: 'SubTrigger Text' }, { key: 'delete', label: 'Delete', danger: true }, { key: 'disabled', label: 'Disabled', disabled: true }]} />
    return <Menu className="context-menu-fidelity" selectable items={[{ key: 'edit', label: 'Edit' }, { key: 'copy', label: 'Copy' }, { type: 'divider' }, { key: 'submenu', label: 'SubTrigger Text' }, { key: 'delete', label: 'Delete', danger: true }, { key: 'disabled', label: 'Disabled', disabled: true }]} />
  }
  if (name === 'Hover Card') return <div className="hover-card-fidelity-grid">{['Default', 'Hover', 'Focus', 'Disabled', 'Pressed'].map((state) => <Popover key={state} title="Hover Card" content="The React Framework — created and maintained by Vercel."><Button disabled={state === 'Disabled'} className={`hover-card-state hover-card-${state.toLowerCase()}`}>Trigger Text · {state}</Button></Popover>)}</div>
  if (name === 'Tooltip') return <div className="tooltip-fidelity-grid">{(['top', 'bottom', 'left', 'right'] as const).map((placement) => <Tooltip key={placement} placement={placement} title="This is a tooltip"><Button>{placement[0].toUpperCase() + placement.slice(1)}</Button></Tooltip>)}</div>
  if (name === 'Popover') return <div className="popover-fidelity-demo"><Popover title="Dimensions" content="Set the dimensions for the layer."><Button>Popover trigger</Button></Popover><div className="popover-fidelity-card"><Typography.Text strong>Dimensions</Typography.Text><Typography.Text type="secondary">Set the dimensions for the layer.</Typography.Text>{['Width', 'Max. width', 'Height', 'Max. height'].map((label) => <div className="popover-fidelity-row" key={label}><span>{label}</span><Input size="small" placeholder="Placeholder" /></div>)}</div></div>
  return <Tooltip title="文字提示"><Button>Hover / Focus</Button></Tooltip>
}

function RawComponentDemo({ component }: { component: ComponentSpec }): React.JSX.Element {
  const { name } = component
  if (name === 'Accordion') return <AccordionDemo />
  if (name === 'Alert') return <AlertDemo />
  if (name === 'Alert Dialog') return <AlertDialogDemo />
  if (name === 'Collapsible') return <div className="collapsible-fidelity-card"><Collapse defaultActiveKey={['1']} items={[{ key: '1', label: 'Active item', children: 'Expanded content uses the current surface and foreground tokens.' }, { key: '2', label: 'Inactive item', children: 'Collapsed until selected.' }, { key: '3', label: 'Inactive disabled', collapsible: 'disabled' }]} /></div>
  if (['Dialog', 'Drawer', 'Sheet', 'Dropdown Menu', 'Context Menu', 'Popover', 'Hover Card', 'Tooltip'].includes(name)) return <OverlayDemo name={name} />
  if (name === 'Aspect Ratio') return <AspectRatioDemo />
  if (name === 'Avatar') return <AvatarFidelityDemo />
  if (name === 'Badge') return <div className="badge-fidelity-grid">
    <div className="component-stack"><span className="component-label">Badge / Variant × State · left/right icon false · text Badge</span><Space wrap>
      <Tag>Badge</Tag><Tag color="blue">Secondary</Tag><Tag bordered>Outline</Tag><Tag color="error">Destructive</Tag><Tag color="success">Verified</Tag><Tag bordered color="default">Ghost</Tag>
    </Space><Space wrap><Tag className="badge-fidelity-focus">Focus</Tag><Tag className="badge-fidelity-hover">Hover</Tag><Tag className="badge-fidelity-disabled">Disabled</Tag></Space></div>
    <div className="component-stack"><span className="component-label">Badge Number / Overflow</span><Space size="large"><Badge count={6}><Avatar shape="square" /></Badge><Badge count={99}><Avatar shape="square" /></Badge><Badge count={100} overflowCount={99}><Avatar shape="square" /></Badge></Space></div>
    <div className="component-stack"><span className="component-label">Badge Dot / Status</span><Space size="large"><Badge dot><Avatar shape="square" /></Badge><Badge status="success" text="Success" /><Badge status="warning" text="Warning" /><Badge status="error" text="Error" /></Space></div>
  </div>
  if (name === 'Breadcrumb') return <BreadcrumbFidelityDemo />
  if (name === 'Back') return <Breadcrumb items={[{ title: 'Workspace' }, { title: 'Design' }, { title: name }]} />
  if (name === 'Button Group') return <ButtonGroupFidelityDemo />
  if (name === 'Button') return <Space wrap><Button type="primary">Primary</Button><Button>Outline</Button><Button type="text">Ghost</Button><Button type="link">Link</Button><Button danger>Destructive</Button><Button loading>Loading</Button><Button disabled>Disabled</Button></Space>
  if (name === 'Carousel') return <CarouselFidelityDemo />
  if (name === 'Calendar') return <CalendarFidelityDemo />
  if (name === 'Card') return <CardFidelityDemo />
  if (name === 'Chart') return <div className="chart-fidelity-grid">
    <div><span className="component-label">Area Chart</span><div className="chart-demo chart-area"><span style={{ height: '38%' }} /><span style={{ height: '72%' }} /><span style={{ height: '52%' }} /><span style={{ height: '88%' }} /><span style={{ height: '64%' }} /></div></div>
    <div><span className="component-label">Bar Chart</span><div className="chart-demo"><span style={{ height: '38%' }} /><span style={{ height: '72%' }} /><span style={{ height: '52%' }} /><span style={{ height: '88%' }} /><span style={{ height: '64%' }} /></div></div>
    <div><span className="component-label">Line Chart</span><div className="chart-demo chart-line"><span style={{ height: '28%' }} /><span style={{ height: '54%' }} /><span style={{ height: '44%' }} /><span style={{ height: '76%' }} /><span style={{ height: '62%' }} /></div></div>
    <div><span className="component-label">Pie Chart</span><div className="chart-demo chart-pie"><span /><i /><b /></div></div>
    <div><span className="component-label">Radial Chart</span><div className="chart-demo chart-radial"><span>68%</span></div></div>
  </div>
  if (name === 'Checkbox') return <Panel><div className="checkbox-fidelity-list">
    <div className="checkbox-fidelity-item"><Checkbox>Checkbox Text</Checkbox><Typography.Text type="secondary">Description Text</Typography.Text></div>
    <div className="checkbox-fidelity-item checkbox-placement-end"><Checkbox defaultChecked>Control at End</Checkbox></div>
    <div className="checkbox-fidelity-item"><Checkbox indeterminate>Indeterminate</Checkbox><Typography.Text type="secondary">Mixed value</Typography.Text></div>
    <div className="checkbox-fidelity-item"><Checkbox disabled>Disabled</Checkbox></div>
    <div className="checkbox-fidelity-item"><Checkbox className="fidelity-error-control">Error / invalid</Checkbox><Typography.Text type="danger">Description Text</Typography.Text></div>
  </div></Panel>
  if (name === 'Combobox' || name === 'Select Menu') return <div className="combobox-fidelity-list">
    <Select showSearch placeholder="Default / 输入或选择组件" options={[{ value: 'Button' }, { value: 'Input' }, { value: 'Upload' }]} />
    <Select showSearch status="error" placeholder="Error / invalid" options={[{ value: 'Button' }, { value: 'Input' }]} />
    <Select disabled placeholder="Disabled" options={[{ value: 'Button' }]} />
  </div>
  if (name === 'Command') return <div className="command-demo"><Input prefix="⌘" placeholder="搜索命令" /><List size="small" header={<Typography.Text type="secondary">Workspace</Typography.Text>} dataSource={['打开预览', '复制 token', '切换主题']} renderItem={(item) => <List.Item>{item}<Typography.Text type="secondary">↵</Typography.Text></List.Item>} /><div className="command-empty">No results / empty</div></div>
  if (name === 'Data Table') return <Table size="small" rowSelection={{ type: 'checkbox', selections: [Table.SELECTION_ALL] }} pagination={{ pageSize: 3, total: 5, size: 'small', showSizeChanger: false }} rowKey="key" columns={[{ title: 'Token', dataIndex: 'token', sorter: true }, { title: 'Value', dataIndex: 'value' }, { title: 'State', dataIndex: 'state' }]} dataSource={[{ key: '1', token: 'primary', value: 'var(--bh-color-primary)', state: 'Ready' }, { key: '2', token: 'border', value: 'var(--bh-color-border)', state: 'Mapped' }, { key: '3', token: 'input', value: 'var(--bh-color-primary-white)', state: 'Figma bound' }, { key: '4', token: 'surface', value: 'var(--bh-color-background)', state: 'Ready' }, { key: '5', token: 'focus', value: 'var(--bh-color-ring)', state: 'Mapped' }]} />
  if (name === 'Table') return <div className="table-fidelity-grid"><div><span className="component-label">Default · hover · head text</span><Table size="small" pagination={false} rowKey="key" columns={[{ title: 'Name', dataIndex: 'name' }, { title: 'Status', dataIndex: 'status' }, { title: 'Action', render: () => <Button size="small" type="link">View</Button> }]} dataSource={[{ key: '1', name: 'Button', status: 'Ready' }, { key: '2', name: 'Input', status: 'Mapped' }, { key: '3', name: 'Upload', status: 'Draft' }]} /></div><div className="table-fidelity-button"><span className="component-label">Button variant</span><Table size="small" pagination={false} showHeader={false} rowKey="key" columns={[{ title: 'Name', dataIndex: 'name' }, { title: 'Action', render: () => <Button size="small">Edit</Button> }]} dataSource={[{ key: '1', name: 'Primary' }, { key: '2', name: 'Secondary' }]} /></div></div>
  if (name === 'Date Picker') return <Panel><DatePicker placeholder="Default / 选择日期" /><DatePicker status="error" placeholder="Error / 错误" /><DatePicker disabled placeholder="Disabled / 禁用" /></Panel>
  if (name === 'Direction') return <Space direction="vertical"><Radio.Group defaultValue="ltr" options={[{ label: 'LTR', value: 'ltr' }, { label: 'RTL', value: 'rtl' }]} /><Space.Compact><Button>Back</Button><Button type="primary">Continue</Button></Space.Compact></Space>
  if (name === 'Empty') return <div className="empty-fidelity-grid"><EmptyState scene="no-data" /><EmptyState scene="no-results" illustration={<Avatar size={84}>CN</Avatar>} /><EmptyState scene="no-task" actions={<Button type="primary">Create</Button>} /></div>
  if (name === 'Field' || name === 'Label') return <div className="field-fidelity-grid"><Form layout="vertical"><Form.Item label="Label" help="Description Text"><Input placeholder="Field input" /></Form.Item></Form><Form layout="vertical"><Form.Item label="Invalid field" validateStatus="error" help="This is an invalid field."><Input status="error" placeholder="Error" /></Form.Item></Form></div>
  if (name === 'Input OTP') return <div className="input-otp-fidelity-list"><Input.OTP length={4} /><Input.OTP length={4} status="error" /><Input.OTP length={4} disabled /></div>
  if (name === 'Input Group') return <div className="input-group-fidelity-list"><Space.Compact block><Input placeholder="Input Group / Input" /><Button type="primary">确定</Button></Space.Compact><Space.Compact block><Input.TextArea autoSize={{ minRows: 1, maxRows: 2 }} placeholder="Input Group / Textarea" /><Button>发送</Button></Space.Compact><Space.Compact block><Input status="error" placeholder="Invalid" /><Button disabled>Disabled</Button></Space.Compact></div>
  if (name === 'Item') return <List size="small" bordered className="item-fidelity-list" dataSource={['Icon variant', 'Image variant', 'AvatarGroup variant', 'Avatar variant']} renderItem={(item, index) => <List.Item><Space><Avatar size={24} shape={index === 1 ? 'square' : 'circle'}>{index === 0 ? '⌘' : index === 1 ? 'IMG' : index === 2 ? 'AB' : 'CN'}</Avatar><span>{item}</span></Space><Tag>{index === 3 ? 'Selected' : 'Ready'}</Tag></List.Item>} />
  if (name === 'Kbd') return <div className="kbd-fidelity-grid"><Typography.Text keyboard>Ctrl</Typography.Text><Typography.Text keyboard className="kbd-primary">⌘ K</Typography.Text></div>
  if (name === 'Input') return <Panel><Input placeholder="Default / 输入项目名称" /><Input status="error" placeholder="Error / 错误" /><Input disabled placeholder="Disabled / 禁用" /><Input.TextArea rows={3} placeholder="Textarea" /></Panel>
  if (name === 'Menubar' || name === 'Navigation Menu') return <Menu mode="horizontal" selectedKeys={['components']} items={[{ key: 'overview', label: 'Overview' }, { key: 'components', label: 'Components' }, { key: 'tokens', label: 'Tokens' }]} />
  if (name === 'Pagination') return <Pagination defaultCurrent={1} total={30} showSizeChanger={false} />
  if (name === 'Progress') return <Panel><div className="progress-fidelity-list">{[100, 75, 50, 25, 0].map((percent) => <Progress key={percent} percent={percent} />)}</div><Progress type="circle" percent={42} size={72} status="active" /><Progress type="circle" percent={25} size={72} status="exception" /></Panel>
  if (name === 'Radio Group') return <Panel><Radio.Group defaultValue="a" options={[{ label: 'Light', value: 'a' }, { label: 'Dark', value: 'b' }]} /><Radio.Group disabled options={[{ label: 'Disabled', value: 'disabled' }]} /></Panel>
  if (name === 'Resizable') return <div className="resizable-demo"><div className="sidebar-demo">Sidebar</div><div className="scroll-area-demo">Resizable panel<br />Design v2 tokens</div></div>
  if (name === 'Scroll Area') return <div className="scroll-area-demo">Scroll Area<br />Content remains within the demo viewport.<br />Design v2 tokens</div>
  if (name === 'Separator') return <div className="separator-fidelity"><div><span>Horizontal</span><Divider /></div><div className="separator-vertical"><span>Vertical</span><Divider type="vertical" /></div></div>
  if (name === 'Sidebar') return <div className="sidebar-fidelity-grid">
    <div className="sidebar-fidelity-panel"><span className="component-label">Submenu: False · expanded</span><Menu mode="inline" selectable selectedKeys={['components']} items={[{ key: 'overview', label: 'Overview' }, { key: 'components', label: 'Components' }, { key: 'tokens', label: 'Tokens' }]} /></div>
    <div className="sidebar-fidelity-panel sidebar-fidelity-collapsed"><span className="component-label">Submenu: True · active item</span><Menu mode="inline" selectable selectedKeys={['tokens']} items={[{ key: 'overview', label: 'Overview' }, { key: 'components', label: 'Components', children: [{ key: 'tokens', label: 'Tokens' }, { key: 'themes', label: 'Themes' }] }]} /></div>
  </div>
  if (name === 'Skeleton') return <div className="skeleton-fidelity-grid">
    <div><span className="component-label">Default · active</span><Skeleton active /></div>
    <div><span className="component-label">Card · avatar</span><Skeleton active avatar paragraph={{ rows: 2 }} /></div>
    <div><span className="component-label">Text · paragraph</span><Skeleton active title={false} paragraph={{ rows: 3, width: ['100%', '88%', '64%'] }} /></div>
    <div><span className="component-label">Form / Table</span><Skeleton active title paragraph={{ rows: 4 }} /></div>
  </div>
  if (name === 'Slider') return <div className="slider-fidelity-grid">
    <div><span className="component-label">Default</span><Slider defaultValue={48} /></div>
    <div><span className="component-label">Hover / Focus</span><Slider className="slider-fidelity-focus" defaultValue={72} tooltip={{ open: true, formatter: (value) => `${value}%` }} /></div>
    <div><span className="component-label">Range</span><Slider range defaultValue={[24, 68]} /></div>
    <div><span className="component-label">Disabled</span><Slider disabled defaultValue={36} /></div>
  </div>
  if (name === 'Spinner') return <div className="spinner-fidelity-grid">
    <div><span className="component-label">Size 8</span><Spin size="small" /></div>
    <div><span className="component-label">Size 6</span><Spin /></div>
    <div><span className="component-label">Size 5</span><Spin size="large" /></div>
    <div><span className="component-label">Size 4 / 3 · IconPlaceholder</span><Spin indicator={<span className="spinner-placeholder">◌</span>} /></div>
  </div>
  if (name === 'Sonner') return <div className="sonner-fidelity-grid">
    <div className="sonner-fidelity-toast"><div><strong>Event has been created</strong><span>Sunday, December 03, 2023 at 9:00 AM</span></div><Button size="small" type="text">Undo</Button></div>
    <div className="sonner-fidelity-toast sonner-fidelity-success"><div><strong>Changes saved</strong><span>Your theme is ready to use.</span></div><Button size="small">View</Button></div>
    <div className="sonner-fidelity-toast sonner-fidelity-error"><div><strong>Something went wrong</strong><span>Please try again in a moment.</span></div><Button size="small" type="primary">Retry</Button></div>
  </div>
  if (name === 'Switch') return <div className="switch-fidelity-grid">
    <div><span className="component-label">Unchecked / checked</span><Space><Switch /><Switch defaultChecked /></Space></div>
    <div><span className="component-label">Loading</span><Switch loading defaultChecked /></div>
    <div><span className="component-label">Disabled</span><Space><Switch disabled /><Switch disabled defaultChecked /></Space></div>
    <div><span className="component-label">With text</span><Switch checkedChildren="ON" unCheckedChildren="OFF" defaultChecked /></div>
  </div>
  if (name === 'Tabs') return <div className="tabs-fidelity-grid"><div><span className="component-label">Variant: Default · Orientation: Default</span><Tabs items={[{ key: 'overview', label: 'Overview', children: 'Overview / 概览内容' }, { key: 'tokens', label: 'Tokens', children: 'Tokens / 变量内容' }, { key: 'disabled', label: 'Disabled', disabled: true, children: 'Disabled' }]} /></div><div><span className="component-label">Variant: Line · Orientation: Vertical</span><Tabs tabPosition="left" items={[{ key: 'one', label: 'One', children: 'Vertical content' }, { key: 'two', label: 'Two', children: 'Selected content' }, { key: 'three', label: 'Three', children: 'More content' }]} /></div></div>
  if (name === 'Textarea') return <div className="textarea-fidelity-grid"><Input.TextArea placeholder="Default / Placeholder Text" /><Input.TextArea value="Filled value" readOnly /><Input.TextArea className="textarea-fidelity-focus" placeholder="Focus" autoFocus /><Input.TextArea disabled placeholder="Disabled" /><Input.TextArea status="error" placeholder="Error" /><Input.TextArea status="error" value="Error (Focus)" readOnly /></div>
  if (name === 'Toggle') return <div className="toggle-fidelity-grid"><div><span className="component-label">Default · sm · lg</span><Space wrap><Button size="small">Toggle</Button><Button type="primary">Toggle</Button><Button size="large" type="primary">Toggle</Button></Space></div><div><span className="component-label">Outline · hover · focus · pressed · disabled</span><Space wrap><Button>Default</Button><Button className="toggle-fidelity-hover">Hover</Button><Button className="toggle-fidelity-focus">Focus</Button><Button type="primary">Pressed</Button><Button disabled>Disabled</Button></Space></div></div>
  if (name === 'Toggle Group') return <div className="toggle-group-fidelity-grid"><div><span className="component-label">Default · Horizontal</span><Segmented options={['A', 'B', 'C', 'D', 'E']} defaultValue="A" /></div><div><span className="component-label">Fill · With Spacing</span><Space.Compact><Button type="primary">A</Button><Button>B</Button><Button>C</Button></Space.Compact></div><div><span className="component-label">Vertical · multiple · disabled</span><Space direction="vertical"><Segmented vertical options={['One', 'Two', 'Three']} defaultValue="Two" /><Button disabled>Disabled item</Button></Space></div></div>
  if (name === 'Typography') return <Space direction="vertical"><Typography.Title level={2} style={{ margin: 0 }}>This is heading 2</Typography.Title><Typography.Title level={4} style={{ margin: 0 }}>Heading 4 / 标题</Typography.Title><Typography.Paragraph style={{ margin: 0 }}>Body text / 正文使用 text/default，说明文字使用 text/description。</Typography.Paragraph><Typography.Text type="secondary">Description text · <Typography.Text code>var(--bh-color-primary)</Typography.Text> · <Typography.Text keyboard>⌘ K</Typography.Text></Typography.Text></Space>
  if (name === 'Utility Components') return <div className="utility-fidelity-grid"><Card size="small" title="_Chart / Card" extra={<Tag color="blue">Slot</Tag>}><div className="utility-mini-chart"><span /><span /><span /><span /><span /></div><Typography.Text strong>Footer Text</Typography.Text><Typography.Text type="secondary">Footer Description Text</Typography.Text></Card><div className="utility-fidelity-row"><Tag>Flex</Tag><Tag>Space</Tag><Tag>AreaChart</Tag><Tag>Watermark</Tag><Tag>FloatButton</Tag></div></div>
  if (name === 'Tag') return <div className="tag-fidelity-grid"><div><span className="component-label">Sizes · default</span><Space wrap><Tag>Large</Tag><Tag className="tag-size-middle">Middle</Tag><Tag className="tag-size-small">Small</Tag><Tag className="tag-size-mini">Mini</Tag></Space></div><div><span className="component-label">Palette · filled / outlined</span><Space wrap><Tag color="blue">极致蓝</Tag><Tag color="cyan">碧涛青</Tag><Tag color="green">仙野绿</Tag><Tag color="orange">活力橙</Tag><Tag color="magenta">品红</Tag><Tag color="purple">青春紫</Tag><Tag color="red">浪漫红</Tag><Tag bordered color="default">Outline</Tag></Space></div></div>
  if (name === 'Tree') return <div className="tree-fidelity-grid"><Tree selectable defaultExpandAll defaultSelectedKeys={['0-1']} treeData={[{ title: 'Design v2', key: '0', children: [{ title: 'Tokens', key: '0-0' }, { title: 'Components', key: '0-1', children: [{ title: 'Button', key: '0-1-0' }, { title: 'Input (disabled)', key: '0-1-1', disabled: true }] }] }]} /><Tree checkable defaultExpandAll defaultCheckedKeys={['1-0']} treeData={[{ title: 'Themes', key: '1', children: [{ title: 'Light', key: '1-0' }, { title: 'Dark', key: '1-1' }] }]} /></div>
  if (name === 'Rate') return <div className="rate-fidelity-grid"><div><span className="component-label">Default · half</span><Rate defaultValue={4.5} allowHalf /></div><div><span className="component-label">Clear</span><Rate defaultValue={3} allowClear /></div><div><span className="component-label">Disabled</span><Rate disabled defaultValue={4} /></div></div>
  if (name === 'Popconfirm') return <div className="popconfirm-fidelity-grid">{(['上左', '上', '上右', '下左', '下', '下右', '左', '右'] as const).map((placement, index) => <Popconfirm key={placement} placement={['topLeft', 'top', 'topRight', 'bottomLeft', 'bottom', 'bottomRight', 'left', 'right'][index] as 'topLeft'} title="确认删除这个草稿？" okText="删除" cancelText="取消"><Button size="small" danger={index === 5}>{placement}</Button></Popconfirm>)}<Popconfirm title="正在删除" okButtonProps={{ loading: true }}><Button size="small">Loading</Button></Popconfirm></div>
  if (name === 'Result') return <div className="result-fidelity-grid">{(['success', 'info', 'warning', 'error'] as const).map((status) => <Result key={status} status={status} title={`${status[0].toUpperCase() + status.slice(1)} result`} subTitle="Operation completed with the current theme." extra={<Button size="small" type={status === 'success' ? 'primary' : 'default'}>Continue</Button>} />)}</div>
  if (name === 'Back') return <div className="back-fidelity-grid"><Button type="text">← Back</Button><Button className="back-fidelity-hover">← Hover</Button><Button disabled>← Disabled</Button></div>
  if (name === 'Steps') return <div className="steps-fidelity-grid"><Steps current={1} items={[{ title: '完成', status: 'finish' }, { title: '进行中', status: 'process' }, { title: '等待', status: 'wait' }, { title: '错误', status: 'error' }]} /><Steps direction="vertical" current={1} items={[{ title: '配置' }, { title: '主题接入' }, { title: '发布' }]} /></div>
  if (name === 'Comment') return <div className="comment-fidelity-card"><div className="comment-fidelity-head"><Avatar size={32}>U</Avatar><div><Typography.Text strong>Design review</Typography.Text><Typography.Text type="secondary">刚刚 · 操作对齐：右</Typography.Text></div></div><Typography.Paragraph>已完成 token 对齐，当前主题下的变量绑定与 Figma 说明一致。</Typography.Paragraph><Space size="small"><Button type="link" size="small">Reply</Button><Button type="link" size="small">Edit</Button><Button type="link" size="small">Like</Button></Space></div>
  if (name === 'Transfer') { const data = [{ key: 'button', title: 'Button' }, { key: 'input', title: 'Input' }, { key: 'upload', title: 'Upload' }, { key: 'table', title: 'Table' }]; return <div className="transfer-fidelity-grid"><div><span className="component-label">标准 · search · footer</span><Transfer showSearch dataSource={data} targetKeys={['button']} render={(item) => item.title} listStyle={{ width: 150, height: 150 }} /></div><div><span className="component-label">单向 / 简单</span><Transfer oneWay dataSource={data.slice(0, 3)} targetKeys={['input']} render={(item) => item.title} listStyle={{ width: 150, height: 150 }} /></div></div> }
  if (name === 'Descriptions') return <div className="descriptions-fidelity-grid"><Descriptions size="middle" bordered column={1} title="Large / Preset"><Descriptions.Item label="Preset">default</Descriptions.Item><Descriptions.Item label="Mode">light</Descriptions.Item></Descriptions><Descriptions size="small" items={[{ key: '1', label: 'Token', children: 'primary' }, { key: '2', label: 'Source', children: 'Figma' }]} /></div>
  if (name === 'Upload') return <div className="upload-fidelity-grid"><div><span className="component-label">Default / drag</span><Upload.Dragger beforeUpload={() => false} showUploadList={false}><p className="ant-upload-drag-icon">↥</p><p>点击或拖拽文件到此区域上传</p><p className="ant-upload-hint">支持多种文件类型</p></Upload.Dragger></div><div><span className="component-label">Uploading / error</span><Upload.Dragger beforeUpload={() => false} showUploadList={{ showRemoveIcon: false }} fileList={[{ uid: 'uploading', name: 'tokens.json', status: 'uploading', percent: 54 }, { uid: 'error', name: 'theme.css', status: 'error', response: 'Upload failed' }]}><p>上传中 / 错误状态</p></Upload.Dragger></div><div><span className="component-label">Disabled</span><Upload disabled beforeUpload={() => false} showUploadList={false}><Button disabled>选择文件</Button></Upload></div></div>
  if (name === 'TreeSelect') return <TreeSelect style={{ width: '100%' }} treeDefaultExpandAll treeData={[{ value: 'design', title: 'Design v2', children: [{ value: 'tokens', title: 'Tokens' }] }]} />
  if (name === 'TimePicker') return <TimePicker format="HH:mm" placeholder="选择时间" />
  return <Card>{name} / example shell</Card>
}

function FidelitySurface({ component, children }: { component: ComponentSpec; children: React.ReactNode }): React.JSX.Element {
  if (['Accordion', 'Alert', 'Alert Dialog', 'Aspect Ratio'].includes(component.name)) return <>{children}</>
  return <div className="component-fidelity-surface" data-component={component.id}>
    <div className="component-fidelity-heading">
      <span className="component-label">CURRENT THEME / FIGMA VARIANT MATRIX</span>
      <span className="component-fidelity-binding">{component.variableBinding}</span>
    </div>
    <div className="component-fidelity-sizes" aria-label={`${component.name} sizes`}>
      {component.sizes.map((size) => <span key={size}>{size}</span>)}
    </div>
    <div className="component-fidelity-states" aria-label={`${component.name} states`}>
      {component.states.map((state) => <span key={state}>{state}</span>)}
    </div>
    <div className="component-fidelity-content">{children}</div>
  </div>
}

export function ComponentDemo({ component }: { component: ComponentSpec }): React.JSX.Element {
  return <FidelitySurface component={component}><RawComponentDemo component={component} /></FidelitySurface>
}

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DefinitionList } from './DefinitionList'
import { SchemaInputField } from './SchemaInputField'
import { StatusBadge, statusMeta } from './StatusBadge'
import { TaskProgress } from '../task/TaskProgress'

describe('lab-ui shared components', () => {
  it('renders definition values, missing text and variants', () => {
    render(
      <DefinitionList
        ariaLabel="事实"
        variant="form"
        columns={2}
        items={[
          { key: 'id', label: 'ID', value: 'm-1', mono: true },
          { key: 'empty', label: '描述', value: '', missingText: '未填写', wide: true },
          { key: 'null', label: '备注', value: null },
        ]}
      />,
    )
    expect(screen.getByLabelText('事实')).toBeInTheDocument()
    expect(screen.getByText('m-1')).toBeInTheDocument()
    expect(screen.getByText('未填写')).toBeInTheDocument()
    expect(screen.getByText('未提供')).toBeInTheDocument()
  })

  it('maps known and unknown statuses and permits explicit metadata', () => {
    expect(statusMeta('RUNNING')).toMatchObject({ label: '执行中', tone: 'warning' })
    expect(statusMeta('new_status')).toMatchObject({ label: 'new_status', tone: 'neutral' })
    render(
      <>
        <StatusBadge status="failed" label="设备报错" />
        <StatusBadge meta={{ label: '自定义', tone: 'info', icon: 'general/info-circle' }} />
      </>,
    )
    expect(screen.getByText('设备报错')).toBeInTheDocument()
    expect(screen.getByText('自定义')).toBeInTheDocument()
  })

  it.each([
    ['enum', { enum: ['a', 'b'] }, 'a'],
    ['boolean', { type: 'boolean' }, true],
    ['number', { type: 'number', minimum: 1, maximum: 5 }, 3],
    ['integer', { type: 'integer' }, 2],
    ['resource', { $slot: 'ResourceSlot' }, 'resource-1'],
    ['object', { type: 'object' }, '{"a":1}'],
    ['array', { type: 'array' }, '[1]'],
    ['string', { type: 'string' }, 'hello'],
  ])('renders %s schema input and emits converted values', (_kind, schema, value) => {
    const onChange = vi.fn()
    render(
      <SchemaInputField
        label="参数"
        name="parameter"
        schema={schema}
        value={value}
        required
        description="说明"
        error="错误"
        onChange={onChange}
      />,
    )
    expect(screen.getAllByText('参数')).toHaveLength(1)
    expect(screen.getByText('说明')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('错误')
    const control = screen.getByRole(
      schema.enum
        ? 'combobox'
        : schema.type === 'boolean'
          ? 'checkbox'
          : schema.type === 'number' || schema.type === 'integer'
            ? 'spinbutton'
            : 'textbox',
    )
    if (schema.enum) {
      fireEvent.change(control, { target: { value: 'b' } })
      expect(onChange).toHaveBeenCalledWith('b')
    } else if (schema.type === 'boolean') {
      fireEvent.click(control)
      expect(onChange).toHaveBeenCalledWith(false)
    } else if (schema.type === 'number' || schema.type === 'integer') {
      fireEvent.change(control, { target: { value: '4' } })
      expect(onChange).toHaveBeenCalledWith(4)
    } else {
      fireEvent.change(control, { target: { value: 'changed' } })
      expect(onChange).toHaveBeenCalledWith('changed')
    }
  })

  it('supports nullable schema types, object values and disabled fields', () => {
    const onChange = vi.fn()
    render(
      <SchemaInputField
        label="备注"
        schema={{ type: ['null', 'string'] }}
        value={{ hello: 'world' }}
        disabled
        placeholder="占位"
        onChange={onChange}
      />,
    )
    const input = screen.getByDisplayValue('{"hello":"world"}')
    expect(input).toBeDisabled()
    expect(input).toHaveAttribute('placeholder', '占位')
  })

  it('normalizes task progress and exposes an accessible bar', () => {
    const { rerender } = render(
      <TaskProgress percent={120} completed={2} total={3} variant="bar" data-testid="progress" />,
    )
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    rerender(<TaskProgress percent={-3} completed={0} total={3} variant="inline" />)
    expect(screen.getByText('0%')).toBeInTheDocument()
    rerender(<TaskProgress percent={Number.NaN} completed={0} total={3} variant="bar" />)
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAccessibleName('任务进度未提供')
  })
})

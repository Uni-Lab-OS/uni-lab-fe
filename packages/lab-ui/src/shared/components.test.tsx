import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DefinitionList, StatusBadge, TaskProgress } from '../index'
// SchemaInputField is an internal primitive shared by the public workflow/device forms.
import { SchemaInputField } from './SchemaInputField'

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
    render(
      <>
        <StatusBadge status="failed" label="设备报错" />
        <StatusBadge status="new_status" />
        <StatusBadge meta={{ label: '自定义', tone: 'info', icon: 'general/info-circle' }} />
      </>,
    )
    expect(screen.getByText('设备报错')).toBeInTheDocument()
    expect(screen.getByText('new_status')).toBeInTheDocument()
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

  it('supports nullable schema types, object values and disabled fields', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
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
    await user.type(input, 'ignored')
    expect(onChange).not.toHaveBeenCalled()

    rerender(
      <SchemaInputField
        label="对象"
        schema={{ type: 'object' }}
        value={{ hello: 'world' }}
        onChange={onChange}
      />,
    )
    const objectInput = screen.getByDisplayValue('{"hello":"world"}')
    expect(objectInput.tagName).toBe('TEXTAREA')
    fireEvent.change(objectInput, { target: { value: '{"next":true}' } })
    expect(onChange).toHaveBeenCalledWith('{"next":true}')

    rerender(
      <SchemaInputField
        label="资源"
        schema={{ $slot: 'ResourceSlot' }}
        value=""
        resource
        placeholder="资源 UUID"
        onChange={onChange}
      />,
    )
    const resourceInput = screen.getByPlaceholderText('资源 UUID')
    expect(resourceInput.tagName).toBe('INPUT')
    fireEvent.change(resourceInput, { target: { value: 'resource-1' } })
    expect(onChange).toHaveBeenCalledWith('resource-1')

    rerender(
      <SchemaInputField
        label="数量"
        schema={{ type: 'number' }}
        value={3}
        onChange={onChange}
      />,
    )
    const numberInput = screen.getByRole('spinbutton')
    fireEvent.change(numberInput, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith('')
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
    const progressbar = screen.getByRole('progressbar')
    expect(progressbar).toHaveAccessibleName('任务进度未提供')
    expect(progressbar).not.toHaveAttribute('aria-valuenow')
  })
})

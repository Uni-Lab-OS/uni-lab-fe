import type { PublishedWorkflowRevision, PublishedWorkflowRevisionSummary } from './model'

export interface WorkflowDefinitionPort {
  listPublishedRevisions(input?: {
    readonly page?: number
    readonly pageSize?: number
    /** 根据服务端 has_more 读取后续页，供本地搜索和分类使用。 */
    readonly allPages?: boolean
    /** 列表页可读取完整目录；默认仍只读取已发布版本。 */
    readonly status?: 'published' | 'all'
  }): Promise<readonly PublishedWorkflowRevisionSummary[]>

  getPublishedRevision(workflowUuid: string): Promise<PublishedWorkflowRevision>
}

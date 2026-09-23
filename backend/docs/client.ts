// Copy this standalone file into the frontend, e.g. src/api.ts.
export type Role = 'business' | 'student';
export type TaskValues = Record<'title'|'context'|'need'|'users'|'data'|'constraints'|'result'|'success'|'contact'|'interaction', string>;
export type TaskView = {
  id: string; topic: string; draft: string; values: TaskValues; published: boolean;
  revision?: number; confirmedRevision?: number | null; hasPublishedVersion: boolean;
  rating: {score:number; level:string; breakdown:{label:string;weight:number;earned:number;keys:string[]}[];missing:{label:string;points:number;fields:string[]}[]};
};
export type Proposal = {id:string;taskId:string;teamId:string;idea:string;plan:string;deadline:string;url:string;status:'pending'|'selected'|'rejected';revision:number;completed:string[]};
export type Team = {id:string;name:string;interests:string;skills:string;technologies:string;points:number};
type Data<T> = {data:T};
type Offer = Pick<Proposal,'idea'|'plan'|'deadline'|'url'>;
export class BackendError extends Error {
  status:number;code:string;
  constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;}
}
export function createApi(baseUrl='', role:Role='business', teamId='team-0') {
  async function request<T>(path:string, method='GET', body?:unknown):Promise<T>{
    const response=await fetch(baseUrl+path,{
      method,headers:{'Content-Type':'application/json','X-Demo-Role':role,'X-Team-Id':teamId},
      body:body===undefined?undefined:JSON.stringify(body),
    });
    const result=await response.json();
    if(!response.ok)throw new BackendError(response.status,result.error?.code??'HTTP_ERROR',result.error?.message??'Сервер қатесі');
    return result;
  }
  const id=(value:string)=>encodeURIComponent(value);
  return {
    health:()=>request<Data<{status:string;aiMode:string}>>('/api/health'),
    meta:()=>request<Data<{fields:Record<string,string>;topics:string[];levels:string[]}>>('/api/meta'),
    catalog:(filters:{topic?:string;level?:string}={})=>request<Data<TaskView[]> & {total:number}>('/api/tasks?'+new URLSearchParams(filters)),
    businessTasks:()=>request<Data<TaskView[]>>('/api/business/tasks'),
    task:(taskId:string)=>request<Data<TaskView>>('/api/tasks/'+id(taskId)),
    createTask:(draft:string,topic:string)=>request<Data<TaskView>>('/api/tasks','POST',{draft,topic}),
    updateTask:(taskId:string,expectedRevision:number,values:Partial<TaskValues>)=>request<Data<TaskView>>('/api/tasks/'+id(taskId),'PATCH',{expectedRevision,values}),
    patchTask:(taskId:string,expectedRevision:number,changes:{values?:Partial<TaskValues>;topic?:string;draft?:string})=>request<Data<TaskView>>('/api/tasks/'+id(taskId),'PATCH',{expectedRevision,...changes}),
    clarify:(taskId:string,expectedRevision:number)=>request<Data<TaskView> & {ai:{mode:string;questions:{field:keyof TaskValues;text:string}[]}}>('/api/tasks/'+id(taskId)+'/clarify','POST',{expectedRevision}),
    confirm:(taskId:string,expectedRevision:number)=>request<Data<TaskView>>('/api/tasks/'+id(taskId)+'/confirm','POST',{expectedRevision}),
    publish:(taskId:string,expectedRevision:number)=>request<Data<TaskView>>('/api/tasks/'+id(taskId)+'/publish','POST',{expectedRevision}),
    teams:()=>request<Data<Team[]>>('/api/teams'),
    proposals:(taskId:string)=>request<Data<Proposal[]>>('/api/tasks/'+id(taskId)+'/proposals'),
    propose:(taskId:string,offer:Offer)=>request<Data<Proposal>>('/api/tasks/'+id(taskId)+'/proposals','POST',offer),
    decide:(proposalId:string,expectedRevision:number,status:'selected'|'rejected')=>request<Data<Proposal>>('/api/proposals/'+id(proposalId),'PATCH',{expectedRevision,status}),
    confirmStage:(taskId:string,teamId:string,stage:'prototype'|'pilot',evidence:string)=>request<Data<{awarded:boolean;points:number;stage:string}>>('/api/tasks/'+id(taskId)+'/milestones/confirm','POST',{teamId,stage,evidence}),
  };
}


export async function execute(context) {
 const {command,state,skill}=context
 state.delivery=await(await skill('/deliveries','POST',{
   executionId:command.executionId,resourceId:command.resourceId,account:command.account,org:command.org,...command.payload,
 },{'Idempotency-Key':command.executionId+':reserve'})).json()
 state.status='awaiting_delivery'

      
}

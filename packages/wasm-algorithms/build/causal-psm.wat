(module
 (type $0 (func (param i32 i32 i32 i32 i32 i32) (result i32)))
 (type $1 (func (param i32 i32 i32 i32 i32 i32 i32) (result i32)))
 (type $2 (func (param i32 i32 i32 i32) (result i32)))
 (import "env" "memory" (memory $0 1 1024))
 (global $assembly/causal-psm/abi_version i32 (i32.const 1))
 (export "abi_version" (global $assembly/causal-psm/abi_version))
 (export "run" (func $assembly/causal-psm/run))
 (export "memory" (memory $0))
 (func $assembly/causal-psm/iptw (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32) (param $5 i32) (result i32)
  (local $6 i64)
  (local $7 i64)
  (local $8 i64)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  (local $13 i32)
  (local $14 i32)
  (local $15 i32)
  (local $16 i32)
  (local $17 i64)
  (local $18 i64)
  (local $19 i32)
  (local $20 i64)
  (local $21 i64)
  (local $22 i64)
  (local $23 i32)
  (local $24 i32)
  (local $25 i64)
  loop $for-loop|0
   local.get $2
   local.get $15
   i32.gt_s
   if
    i32.const 0
    local.set $10
    i32.const 0
    local.set $11
    i32.const 0
    local.set $12
    i32.const 0
    local.set $13
    i32.const 0
    local.set $9
    loop $for-loop|1
     local.get $1
     local.get $9
     i32.gt_s
     if
      i32.const 1
      local.get $0
      local.get $1
      i32.add
      local.get $9
      i32.add
      i32.load8_u
      local.tee $23
      i32.const 1
      i32.ne
      i32.const 0
      local.get $23
      select
      i32.const 1
      local.get $0
      local.get $9
      i32.add
      i32.load8_u
      local.tee $19
      i32.const 1
      i32.ne
      i32.const 0
      local.get $19
      select
      local.get $0
      local.get $1
      i32.const 1
      i32.shl
      i32.add
      local.get $9
      i32.add
      i32.load8_u
      local.tee $24
      local.get $2
      i32.ge_s
      select
      select
      if
       i32.const 3
       return
      end
      local.get $15
      local.get $24
      i32.eq
      if
       local.get $23
       i32.const 1
       i32.eq
       local.get $19
       i32.const 1
       i32.eq
       i32.and
       if
        local.get $10
        i32.const 1
        i32.add
        local.set $10
       else
        local.get $23
        i32.eqz
        local.get $19
        i32.const 1
        i32.eq
        i32.and
        if
         local.get $11
         i32.const 1
         i32.add
         local.set $11
        else
         local.get $19
         i32.eqz
         local.get $23
         i32.const 1
         i32.eq
         i32.and
         if
          local.get $12
          i32.const 1
          i32.add
          local.set $12
         else
          local.get $13
          i32.const 1
          i32.add
          local.set $13
         end
        end
       end
      end
      local.get $9
      i32.const 1
      i32.add
      local.set $9
      br $for-loop|1
     end
    end
    local.get $12
    local.get $13
    i32.add
    local.tee $9
    local.get $3
    i32.lt_s
    local.get $10
    local.get $11
    i32.add
    local.tee $19
    local.get $3
    i32.lt_s
    i32.or
    i32.eqz
    if
     local.get $9
     local.get $19
     i32.add
     local.tee $23
     local.get $14
     i32.add
     local.set $14
     local.get $16
     i32.const 1
     i32.add
     local.set $16
     local.get $17
     local.get $4
     i64.extend_i32_s
     local.tee $20
     local.get $23
     i64.extend_i32_s
     local.tee $25
     i64.mul
     local.tee $17
     local.get $10
     i64.extend_i32_s
     local.tee $8
     i64.mul
     local.get $19
     i64.extend_i32_s
     local.tee $21
     i64.div_s
     i64.add
     local.get $12
     i64.extend_i32_s
     local.tee $18
     local.get $17
     i64.mul
     local.get $9
     i64.extend_i32_s
     local.tee $22
     i64.div_s
     i64.sub
     local.set $17
     local.get $6
     local.get $8
     local.get $11
     i64.extend_i32_s
     i64.mul
     local.get $20
     i64.mul
     local.get $21
     i64.div_s
     local.get $21
     i64.div_s
     local.get $20
     i64.mul
     local.get $21
     i64.div_s
     local.get $18
     local.get $13
     i64.extend_i32_s
     i64.mul
     local.get $20
     i64.mul
     local.get $22
     i64.div_s
     local.get $22
     i64.div_s
     local.get $20
     i64.mul
     local.get $22
     i64.div_s
     i64.add
     local.get $25
     local.get $25
     i64.mul
     i64.mul
     i64.add
     local.set $6
    end
    local.get $15
    i32.const 1
    i32.add
    local.set $15
    br $for-loop|0
   end
  end
  local.get $14
  i32.eqz
  if
   local.get $5
   i32.const 0
   i32.store
   local.get $5
   i32.const 0
   i32.store offset=4
   local.get $5
   i32.const 0
   i32.store offset=8
   local.get $5
   i32.const 0
   i32.store offset=12
   local.get $5
   i32.const 0
   i32.store offset=16
   local.get $5
   i32.const 1
   i32.store offset=20
   i32.const 0
   return
  end
  local.get $6
  local.get $14
  i64.extend_i32_s
  local.tee $6
  local.get $6
  i64.mul
  i64.div_s
  local.set $8
  block $__inlined_func$assembly/causal-psm/satI32$1 (result i32)
   i32.const -2147483648
   local.get $17
   local.get $6
   i64.div_s
   local.tee $6
   i64.const -2147483648
   i64.lt_s
   br_if $__inlined_func$assembly/causal-psm/satI32$1
   drop
   i32.const 2147483647
   local.get $6
   i64.const 2147483647
   i64.gt_s
   br_if $__inlined_func$assembly/causal-psm/satI32$1
   drop
   local.get $6
   i32.wrap_i64
  end
  local.set $0
  block $__inlined_func$assembly/causal-psm/satI32$3 (result i32)
   local.get $8
   i64.const 0
   i64.gt_s
   if
    local.get $8
    local.tee $7
    i64.const 1
    i64.add
    i64.const 2
    i64.div_s
    local.set $6
    loop $while-continue|0
     local.get $6
     local.get $7
     i64.lt_s
     if
      local.get $8
      local.get $6
      local.tee $7
      i64.div_s
      local.get $7
      i64.add
      i64.const 2
      i64.div_s
      local.set $6
      br $while-continue|0
     end
    end
   end
   i32.const -2147483648
   local.get $7
   i64.const -2147483648
   i64.lt_s
   br_if $__inlined_func$assembly/causal-psm/satI32$3
   drop
   i32.const 2147483647
   local.get $7
   i64.const 2147483647
   i64.gt_s
   br_if $__inlined_func$assembly/causal-psm/satI32$3
   drop
   local.get $7
   i32.wrap_i64
  end
  local.set $1
  local.get $5
  i32.const 0
  i32.store
  local.get $5
  local.get $0
  i32.store offset=4
  local.get $5
  local.get $1
  i32.store offset=8
  local.get $5
  local.get $14
  i32.store offset=12
  local.get $5
  local.get $16
  i32.store offset=16
  local.get $5
  i32.const 0
  i32.store offset=20
  i32.const 0
 )
 (func $assembly/causal-psm/psm (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32) (param $5 i32) (param $6 i32) (result i32)
  (local $7 i64)
  (local $8 i32)
  (local $9 i32)
  (local $10 i64)
  (local $11 i64)
  (local $12 i32)
  (local $13 i32)
  (local $14 i32)
  (local $15 i32)
  (local $16 i64)
  (local $17 i32)
  (local $18 i32)
  loop $for-loop|0
   local.get $2
   local.get $14
   i32.gt_s
   if
    i32.const 0
    local.set $12
    i32.const 0
    local.set $13
    i32.const 0
    local.set $8
    loop $for-loop|1
     local.get $1
     local.get $8
     i32.gt_s
     if
      i32.const 1
      local.get $0
      local.get $1
      i32.add
      local.get $8
      i32.add
      i32.load8_u
      local.tee $17
      i32.const 1
      i32.ne
      i32.const 0
      local.get $17
      select
      i32.const 1
      local.get $0
      local.get $8
      i32.add
      i32.load8_u
      local.tee $17
      i32.const 1
      i32.ne
      i32.const 0
      local.get $17
      select
      local.get $0
      local.get $1
      i32.const 1
      i32.shl
      i32.add
      local.get $8
      i32.add
      i32.load8_u
      local.tee $18
      local.get $2
      i32.ge_s
      select
      select
      if
       i32.const 3
       return
      end
      local.get $14
      local.get $18
      i32.eq
      if
       local.get $17
       i32.const 1
       i32.eq
       if
        local.get $12
        i32.const 1
        i32.add
        local.set $12
       else
        local.get $13
        i32.const 1
        i32.add
        local.set $13
       end
      end
      local.get $8
      i32.const 1
      i32.add
      local.set $8
      br $for-loop|1
     end
    end
    local.get $3
    local.get $12
    local.get $13
    local.get $12
    local.get $13
    i32.lt_s
    select
    local.tee $13
    i32.le_s
    if
     local.get $15
     i32.const 1
     i32.add
     local.set $15
     i32.const 0
     local.set $8
     i32.const 0
     local.set $12
     loop $for-loop|2
      local.get $8
      local.get $13
      i32.lt_s
      local.get $1
      local.get $12
      i32.gt_s
      i32.and
      if
       local.get $0
       local.get $12
       i32.add
       i32.load8_u
       i32.const 1
       i32.ne
       local.get $0
       local.get $1
       i32.const 1
       i32.shl
       i32.add
       local.get $12
       i32.add
       i32.load8_u
       local.get $14
       i32.ne
       i32.or
       i32.eqz
       if
        local.get $5
        local.get $8
        i32.add
        local.get $0
        local.get $1
        i32.add
        local.get $12
        i32.add
        i32.load8_u
        i32.store8
        local.get $8
        i32.const 1
        i32.add
        local.set $8
       end
       local.get $12
       i32.const 1
       i32.add
       local.set $12
       br $for-loop|2
      end
     end
     i32.const 0
     local.set $8
     i32.const 0
     local.set $12
     loop $for-loop|3
      local.get $8
      local.get $13
      i32.lt_s
      local.get $1
      local.get $12
      i32.gt_s
      i32.and
      if
       local.get $0
       local.get $12
       i32.add
       i32.load8_u
       local.get $0
       local.get $1
       i32.const 1
       i32.shl
       i32.add
       local.get $12
       i32.add
       i32.load8_u
       local.get $14
       i32.ne
       i32.or
       i32.eqz
       if
        local.get $5
        local.get $8
        i32.add
        i64.load8_u
        local.get $0
        local.get $1
        i32.add
        local.get $12
        i32.add
        i64.load8_u
        i64.sub
        local.tee $11
        local.get $10
        i64.add
        local.set $10
        local.get $8
        i32.const 1
        i32.add
        local.set $8
        local.get $7
        local.get $11
        local.get $11
        i64.mul
        i64.add
        local.set $7
       end
       local.get $12
       i32.const 1
       i32.add
       local.set $12
       br $for-loop|3
      end
     end
     local.get $9
     local.get $13
     i32.add
     local.set $9
    end
    local.get $14
    i32.const 1
    i32.add
    local.set $14
    br $for-loop|0
   end
  end
  local.get $9
  i32.const 2
  i32.lt_s
  if
   local.get $6
   i32.const 1
   i32.store
   local.get $6
   i32.const 0
   i32.store offset=4
   local.get $6
   i32.const 0
   i32.store offset=8
   local.get $6
   i32.const 0
   i32.store offset=12
   local.get $6
   i32.const 0
   i32.store offset=16
   local.get $6
   i32.const 1
   i32.store offset=20
   i32.const 0
   return
  end
  local.get $4
  i64.extend_i32_s
  local.tee $16
  local.get $7
  local.get $9
  i64.extend_i32_s
  local.tee $7
  i64.mul
  local.get $10
  local.get $10
  i64.mul
  i64.sub
  local.get $16
  i64.mul
  local.get $7
  local.get $7
  i64.mul
  i64.div_s
  i64.mul
  local.get $9
  i32.const 1
  i32.sub
  i64.extend_i32_s
  i64.div_s
  local.set $11
  block $__inlined_func$assembly/causal-psm/satI32$6 (result i32)
   i32.const -2147483648
   local.get $10
   local.get $16
   i64.mul
   local.get $7
   i64.div_s
   local.tee $7
   i64.const -2147483648
   i64.lt_s
   br_if $__inlined_func$assembly/causal-psm/satI32$6
   drop
   i32.const 2147483647
   local.get $7
   i64.const 2147483647
   i64.gt_s
   br_if $__inlined_func$assembly/causal-psm/satI32$6
   drop
   local.get $7
   i32.wrap_i64
  end
  local.set $0
  block $__inlined_func$assembly/causal-psm/satI32$8 (result i32)
   i64.const 0
   local.set $10
   local.get $11
   i64.const 0
   i64.gt_s
   if
    local.get $11
    local.tee $10
    i64.const 1
    i64.add
    i64.const 2
    i64.div_s
    local.set $7
    loop $while-continue|0
     local.get $7
     local.get $10
     i64.lt_s
     if
      local.get $11
      local.get $7
      local.tee $10
      i64.div_s
      local.get $10
      i64.add
      i64.const 2
      i64.div_s
      local.set $7
      br $while-continue|0
     end
    end
   end
   i32.const -2147483648
   local.get $10
   i64.const -2147483648
   i64.lt_s
   br_if $__inlined_func$assembly/causal-psm/satI32$8
   drop
   i32.const 2147483647
   local.get $10
   i64.const 2147483647
   i64.gt_s
   br_if $__inlined_func$assembly/causal-psm/satI32$8
   drop
   local.get $10
   i32.wrap_i64
  end
  local.set $1
  local.get $6
  i32.const 1
  i32.store
  local.get $6
  local.get $0
  i32.store offset=4
  local.get $6
  local.get $1
  i32.store offset=8
  local.get $6
  local.get $9
  i32.const 1
  i32.shl
  i32.store offset=12
  local.get $6
  local.get $15
  i32.store offset=16
  local.get $6
  i32.const 0
  i32.store offset=20
  i32.const 0
 )
 (func $assembly/causal-psm/run (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (result i32)
  (local $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  local.get $1
  i32.const 0
  i32.le_s
  local.get $1
  i32.const 1048576
  i32.gt_s
  i32.or
  if
   i32.const 6
   return
  end
  local.get $2
  i32.const 0
  i32.le_s
  local.get $2
  i32.const 64
  i32.gt_s
  i32.or
  if
   i32.const 5
   return
  end
  i32.const 1
  local.get $0
  i32.load offset=8
  local.tee $4
  i32.const 1
  i32.le_s
  i32.const 1
  local.get $0
  i32.load offset=4
  local.tee $5
  i32.const 0
  i32.le_s
  local.get $0
  i32.load
  local.tee $6
  i32.const 1
  i32.ne
  i32.const 0
  local.get $6
  select
  select
  select
  if
   i32.const 5
   return
  end
  local.get $3
  local.get $0
  i32.const 12
  i32.add
  local.tee $0
  local.get $1
  i32.const 3
  i32.mul
  i32.add
  i32.const 7
  i32.add
  i32.const -8
  i32.and
  local.tee $7
  local.get $1
  i32.add
  i32.lt_s
  if
   i32.const 5
   return
  end
  local.get $6
  i32.eqz
  if
   local.get $0
   local.get $1
   local.get $2
   local.get $5
   local.get $4
   local.get $3
   call $assembly/causal-psm/iptw
   return
  end
  local.get $0
  local.get $1
  local.get $2
  local.get $5
  local.get $4
  local.get $7
  local.get $3
  call $assembly/causal-psm/psm
 )
)

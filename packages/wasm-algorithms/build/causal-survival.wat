(module
 (type $0 (func (param i32 i32 i32 i32) (result i32)))
 (import "env" "memory" (memory $0 1 1024))
 (global $assembly/causal-survival/abi_version i32 (i32.const 1))
 (export "abi_version" (global $assembly/causal-survival/abi_version))
 (export "run" (func $assembly/causal-survival/run))
 (export "memory" (memory $0))
 (func $assembly/causal-survival/run (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (result i32)
  (local $4 i32)
  (local $5 i64)
  (local $6 i32)
  (local $7 i64)
  (local $8 i32)
  (local $9 i64)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  (local $13 i32)
  (local $14 i64)
  (local $15 i64)
  (local $16 i32)
  (local $17 i64)
  (local $18 i32)
  (local $19 i32)
  (local $20 i32)
  (local $21 i64)
  (local $22 i32)
  (local $23 i32)
  (local $24 i32)
  local.get $1
  i32.const 0
  i32.le_s
  if
   i32.const 6
   return
  end
  local.get $2
  i32.const 0
  i32.le_s
  local.get $1
  i32.const 4096
  i32.gt_s
  i32.or
  if
   i32.const 5
   return
  end
  local.get $0
  i32.load offset=4
  local.tee $12
  i32.const 0
  i32.le_s
  local.get $0
  i32.load
  local.tee $13
  i32.const 0
  i32.le_s
  i32.or
  local.get $0
  i32.load offset=8
  local.tee $22
  i32.const 1
  i32.le_s
  i32.or
  local.get $0
  i32.load offset=12
  local.tee $23
  i32.const 0
  i32.le_s
  i32.or
  if
   i32.const 5
   return
  end
  local.get $3
  local.get $0
  i32.const 16
  i32.add
  local.tee $16
  local.get $1
  i32.const 3
  i32.shl
  i32.add
  i32.const 7
  i32.add
  i32.const -8
  i32.and
  local.tee $10
  i32.const 65536
  i32.add
  i32.lt_s
  if
   i32.const 5
   return
  end
  i32.const 0
  local.set $0
  loop $for-loop|0
   local.get $0
   i32.const 65536
   i32.lt_s
   if
    local.get $0
    local.get $10
    i32.add
    i32.const 0
    i32.store
    local.get $0
    i32.const 4
    i32.add
    local.set $0
    br $for-loop|0
   end
  end
  i32.const 0
  local.set $2
  loop $for-loop|1
   local.get $1
   local.get $6
   i32.gt_s
   if
    local.get $16
    local.get $6
    i32.const 3
    i32.shl
    i32.add
    local.tee $19
    i32.load8_u
    local.set $0
    i32.const 1
    local.get $19
    i32.load offset=4
    local.tee $18
    i32.const 4095
    i32.gt_s
    i32.const 1
    local.get $18
    i32.const 0
    i32.lt_s
    i32.const 1
    local.get $19
    i32.load8_u offset=1
    local.tee $19
    i32.const 1
    i32.ne
    i32.const 0
    local.get $19
    select
    local.get $0
    i32.const 1
    i32.ne
    i32.const 0
    local.get $0
    select
    select
    select
    select
    if
     i32.const 3
     return
    end
    local.get $18
    local.get $2
    local.get $2
    local.get $18
    i32.lt_s
    select
    local.set $2
    local.get $10
    i32.const 8192
    i32.const 12288
    local.get $0
    i32.const 1
    i32.eq
    local.tee $20
    select
    local.get $18
    i32.add
    i32.const 2
    i32.shl
    i32.add
    local.tee $24
    local.get $24
    i32.load
    i32.const 1
    i32.add
    i32.store
    local.get $20
    if
     local.get $8
     i32.const 1
     i32.add
     local.set $8
    else
     local.get $11
     i32.const 1
     i32.add
     local.set $11
    end
    local.get $19
    i32.const 1
    i32.eq
    if
     local.get $10
     local.get $0
     i32.const 1
     i32.ne
     i32.const 12
     i32.shl
     local.get $18
     i32.add
     i32.const 2
     i32.shl
     i32.add
     local.tee $0
     local.get $0
     i32.load
     i32.const 1
     i32.add
     i32.store
     local.get $4
     i32.const 1
     i32.add
     local.set $4
    end
    local.get $6
    i32.const 1
    i32.add
    local.set $6
    br $for-loop|1
   end
  end
  local.get $2
  local.get $12
  i32.div_s
  i32.const 1
  i32.add
  local.get $23
  i32.gt_s
  if
   i32.const 5
   return
  end
  local.get $8
  local.set $0
  i32.const 0
  local.set $6
  local.get $22
  i64.extend_i32_s
  local.tee $9
  local.set $21
  i32.const 0
  local.set $8
  loop $for-loop|2
   local.get $2
   local.get $8
   i32.ge_s
   if
    local.get $0
    local.get $11
    i32.add
    local.set $16
    local.get $8
    local.get $12
    i32.rem_s
    i32.eqz
    if
     local.get $3
     i32.const 24
     i32.add
     local.get $6
     i32.const 4
     i32.shl
     i32.add
     local.tee $1
     local.get $8
     i32.store
     local.get $13
     local.get $16
     i32.gt_s
     if
      local.get $1
      i32.const 0
      i32.store offset=4
      local.get $1
      i32.const 0
      i32.store offset=8
      local.get $1
      i32.const 1
      i32.store offset=12
     else
      local.get $1
      block $__inlined_func$assembly/causal-survival/satI32$5 (result i32)
       i32.const -2147483648
       local.get $9
       i64.const -2147483648
       i64.lt_s
       br_if $__inlined_func$assembly/causal-survival/satI32$5
       drop
       i32.const 2147483647
       local.get $9
       i64.const 2147483647
       i64.gt_s
       br_if $__inlined_func$assembly/causal-survival/satI32$5
       drop
       local.get $9
       i32.wrap_i64
      end
      i32.store offset=4
      local.get $1
      local.get $16
      i32.store offset=8
      local.get $1
      i32.const 0
      i32.store offset=12
     end
     local.get $6
     i32.const 1
     i32.add
     local.set $6
    end
    local.get $16
    i32.const 0
    i32.gt_s
    local.get $10
    local.get $8
    i32.const 2
    i32.shl
    i32.add
    i32.load
    local.tee $1
    local.get $10
    local.get $8
    i32.const 4096
    i32.add
    i32.const 2
    i32.shl
    i32.add
    i32.load
    i32.add
    local.tee $18
    i32.const 0
    i32.gt_s
    i32.and
    if
     local.get $15
     local.get $1
     i64.extend_i32_s
     local.get $21
     i64.mul
     local.get $18
     i64.extend_i32_s
     local.get $0
     i64.extend_i32_s
     i64.mul
     local.tee $17
     local.get $21
     i64.mul
     local.get $16
     i64.extend_i32_s
     local.tee $14
     i64.div_s
     i64.sub
     i64.add
     local.set $15
     local.get $7
     local.get $16
     local.get $0
     i32.sub
     i64.extend_i32_s
     local.get $17
     i64.mul
     local.get $21
     i64.mul
     local.get $14
     local.get $14
     i64.mul
     i64.div_s
     i64.add
     local.set $7
     i32.const 0
     local.set $1
     loop $for-loop|3
      local.get $1
      local.get $18
      i32.lt_s
      if
       local.get $9
       local.get $16
       i32.const 1
       i32.sub
       i64.extend_i32_s
       i64.mul
       local.get $16
       i64.extend_i32_s
       i64.div_s
       local.set $9
       local.get $1
       i32.const 1
       i32.add
       local.set $1
       br $for-loop|3
      end
     end
    end
    local.get $0
    local.get $10
    local.get $8
    i32.const -8192
    i32.sub
    i32.const 2
    i32.shl
    i32.add
    i32.load
    i32.sub
    local.set $0
    local.get $11
    local.get $10
    local.get $8
    i32.const 12288
    i32.add
    i32.const 2
    i32.shl
    i32.add
    i32.load
    i32.sub
    local.set $11
    local.get $8
    i32.const 1
    i32.add
    local.set $8
    br $for-loop|2
   end
  end
  local.get $3
  i32.const 0
  i32.store
  local.get $3
  local.get $6
  i32.store offset=16
  local.get $3
  i32.const 0
  i32.store offset=20
  local.get $7
  i64.eqz
  local.get $4
  local.get $13
  i32.lt_s
  i32.or
  if
   local.get $3
   i32.const 0
   i32.store offset=4
   local.get $3
   i32.const 0
   i32.store offset=8
   local.get $3
   i32.const 1
   i32.store offset=12
   i32.const 0
   return
  end
  local.get $21
  local.get $21
  i64.mul
  local.get $21
  i64.mul
  local.get $7
  i64.div_s
  local.set $9
  local.get $3
  block $__inlined_func$assembly/causal-survival/satI32$10 (result i32)
   i32.const -2147483648
   local.get $15
   local.get $21
   i64.mul
   local.get $7
   i64.div_s
   local.tee $7
   i64.const -2147483648
   i64.lt_s
   br_if $__inlined_func$assembly/causal-survival/satI32$10
   drop
   i32.const 2147483647
   local.get $7
   i64.const 2147483647
   i64.gt_s
   br_if $__inlined_func$assembly/causal-survival/satI32$10
   drop
   local.get $7
   i32.wrap_i64
  end
  i32.store offset=4
  local.get $3
  block $__inlined_func$assembly/causal-survival/satI32$12 (result i32)
   local.get $9
   i64.const 0
   i64.gt_s
   if
    local.get $9
    local.tee $5
    i64.const 1
    i64.add
    i64.const 2
    i64.div_s
    local.set $7
    loop $while-continue|0
     local.get $5
     local.get $7
     i64.gt_s
     if
      local.get $7
      local.tee $5
      local.get $9
      local.get $7
      i64.div_s
      i64.add
      i64.const 2
      i64.div_s
      local.set $7
      br $while-continue|0
     end
    end
   end
   i32.const -2147483648
   local.get $5
   i64.const -2147483648
   i64.lt_s
   br_if $__inlined_func$assembly/causal-survival/satI32$12
   drop
   i32.const 2147483647
   local.get $5
   i64.const 2147483647
   i64.gt_s
   br_if $__inlined_func$assembly/causal-survival/satI32$12
   drop
   local.get $5
   i32.wrap_i64
  end
  i32.store offset=8
  local.get $3
  i32.const 0
  i32.store offset=12
  i32.const 0
 )
)

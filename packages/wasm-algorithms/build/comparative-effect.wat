(module
 (type $0 (func (param i32 i32 i32 i32 i32 i32 i32 i32 i32 i32 i32 i32 i32 i32)))
 (type $1 (func (param i32 i32 i32 i32) (result i32)))
 (import "env" "memory" (memory $0 1 1024))
 (global $assembly/comparative-effect/abi_version i32 (i32.const 1))
 (export "abi_version" (global $assembly/comparative-effect/abi_version))
 (export "run" (func $assembly/comparative-effect/run))
 (export "memory" (memory $0))
 (func $assembly/comparative-effect/newton (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32) (param $5 i32) (param $6 i32) (param $7 i32) (param $8 i32) (param $9 i32) (param $10 i32) (param $11 i32) (param $12 i32) (param $13 i32)
  (local $14 i64)
  (local $15 i64)
  (local $16 i32)
  (local $17 i32)
  (local $18 i64)
  (local $19 i64)
  (local $20 i64)
  (local $21 i64)
  (local $22 i32)
  (local $23 i64)
  (local $24 i32)
  (local $25 i64)
  (local $26 i32)
  (local $27 i32)
  (local $28 i32)
  (local $29 i32)
  (local $30 i32)
  (local $31 i32)
  (local $32 i64)
  (local $33 i32)
  local.get $0
  local.get $1
  i32.add
  local.tee $33
  local.get $2
  i32.add
  local.get $3
  i32.add
  local.set $27
  local.get $2
  local.get $3
  i32.add
  local.set $26
  local.get $10
  i64.extend_i32_s
  local.set $32
  loop $for-loop|0
   local.get $8
   local.get $29
   i32.gt_s
   if
    block $for-break0
     block $__inlined_func$assembly/comparative-effect/sigmoidQ (result i32)
      local.get $31
      local.get $6
      i32.sub
      local.tee $17
      i32.const 0
      i32.le_s
      if
       local.get $4
       i32.load
       br $__inlined_func$assembly/comparative-effect/sigmoidQ
      end
      local.get $17
      local.get $7
      local.get $6
      i32.sub
      local.tee $16
      i32.ge_s
      if
       local.get $4
       local.get $5
       i32.const 1
       i32.sub
       i32.const 2
       i32.shl
       i32.add
       i32.load
       br $__inlined_func$assembly/comparative-effect/sigmoidQ
      end
      local.get $4
      local.get $17
      i64.extend_i32_s
      local.get $5
      i32.const 1
      i32.sub
      i64.extend_i32_s
      i64.mul
      local.tee $14
      local.get $16
      i64.extend_i32_s
      local.tee $15
      i64.div_s
      i32.wrap_i64
      local.tee $16
      i32.const 2
      i32.shl
      i32.add
      i64.load32_s
      local.get $15
      local.get $14
      local.get $16
      i64.extend_i32_s
      local.get $15
      i64.mul
      i64.sub
      local.tee $14
      i64.sub
      i64.mul
      local.get $4
      local.get $16
      i32.const 1
      i32.add
      i32.const 2
      i32.shl
      i32.add
      i64.load32_s
      local.get $14
      i64.mul
      i64.add
      local.get $15
      i64.div_s
      i32.wrap_i64
     end
     local.tee $24
     i64.extend_i32_s
     local.get $10
     local.get $24
     i32.sub
     i64.extend_i32_s
     i64.mul
     local.get $10
     i64.extend_i32_s
     local.tee $14
     i64.div_s
     i32.wrap_i64
     local.set $17
     local.get $33
     i64.extend_i32_s
     block $__inlined_func$assembly/comparative-effect/sigmoidQ$1 (result i32)
      local.get $30
      local.get $31
      i32.add
      local.get $6
      i32.sub
      local.tee $22
      i32.const 0
      i32.le_s
      if
       local.get $4
       i32.load
       br $__inlined_func$assembly/comparative-effect/sigmoidQ$1
      end
      local.get $22
      local.get $7
      local.get $6
      i32.sub
      local.tee $16
      i32.ge_s
      if
       local.get $4
       local.get $5
       i32.const 1
       i32.sub
       i32.const 2
       i32.shl
       i32.add
       i32.load
       br $__inlined_func$assembly/comparative-effect/sigmoidQ$1
      end
      local.get $4
      local.get $22
      i64.extend_i32_s
      local.get $5
      i32.const 1
      i32.sub
      i64.extend_i32_s
      i64.mul
      local.tee $15
      local.get $16
      i64.extend_i32_s
      local.tee $18
      i64.div_s
      i32.wrap_i64
      local.tee $16
      i32.const 2
      i32.shl
      i32.add
      i64.load32_s
      local.get $18
      local.get $15
      local.get $16
      i64.extend_i32_s
      local.get $18
      i64.mul
      i64.sub
      local.tee $15
      i64.sub
      i64.mul
      local.get $4
      local.get $16
      i32.const 1
      i32.add
      i32.const 2
      i32.shl
      i32.add
      i64.load32_s
      local.get $15
      i64.mul
      i64.add
      local.get $18
      i64.div_s
      i32.wrap_i64
     end
     local.tee $22
     i64.extend_i32_s
     local.get $10
     local.get $22
     i32.sub
     i64.extend_i32_s
     i64.mul
     local.get $14
     i64.div_s
     i32.wrap_i64
     local.tee $16
     i64.extend_i32_s
     i64.mul
     local.tee $15
     local.get $26
     i64.extend_i32_s
     local.get $17
     i64.extend_i32_s
     i64.mul
     i64.add
     local.tee $25
     local.set $23
     local.get $9
     if (result i64)
      local.get $12
      i64.extend_i32_s
      local.tee $14
      local.get $23
      i64.add
      local.set $23
      local.get $14
      local.get $15
      i64.add
     else
      local.get $15
     end
     local.set $14
     local.get $14
     local.get $23
     i64.mul
     local.get $15
     local.get $15
     i64.mul
     i64.sub
     local.set $20
     local.get $9
     if (result i64)
      local.get $20
      i64.eqz
      if
       i32.const 1
       local.set $28
       br $for-break0
      end
      local.get $11
      local.get $24
      i32.sub
      i64.extend_i32_s
      local.get $14
      local.get $32
      i64.mul
      local.get $32
      i64.mul
      local.get $20
      i64.div_s
      local.tee $18
      local.get $17
      i64.extend_i32_s
      i64.mul
      local.get $32
      i64.div_s
      i64.mul
      local.get $32
      i64.div_s
      local.set $19
      local.get $0
      i64.extend_i32_s
      local.get $11
      local.get $22
      i32.sub
      i64.extend_i32_s
      local.get $16
      i64.extend_i32_s
      local.get $18
      i64.const 0
      local.get $15
      local.get $32
      i64.mul
      local.get $32
      i64.mul
      i64.sub
      local.get $20
      i64.div_s
      i64.const 1
      i64.shl
      i64.add
      local.get $23
      local.get $32
      i64.mul
      local.get $32
      i64.mul
      local.get $20
      i64.div_s
      i64.add
      i64.mul
      local.get $32
      i64.div_s
      i64.mul
      local.get $32
      i64.div_s
      local.tee $18
      local.get $10
      local.get $22
      i32.sub
      i64.extend_i32_s
      i64.add
      i64.mul
      local.set $20
      local.get $1
      i64.extend_i32_s
      local.get $18
      local.get $22
      i64.extend_i32_s
      i64.sub
      i64.mul
      local.tee $21
      local.get $2
      i64.extend_i32_s
      local.get $10
      local.get $24
      i32.sub
      i64.extend_i32_s
      local.get $19
      i64.add
      i64.mul
      local.get $3
      i64.extend_i32_s
      local.get $19
      local.get $24
      i64.extend_i32_s
      i64.sub
      i64.mul
      i64.add
      local.get $20
      i64.add
      i64.add
     else
      local.get $1
      i64.extend_i32_s
      i32.const 0
      local.get $22
      i32.sub
      i64.extend_i32_s
      i64.mul
      local.tee $20
      local.get $0
      i64.extend_i32_s
      local.get $10
      local.get $22
      i32.sub
      i64.extend_i32_s
      i64.mul
      local.tee $21
      local.get $2
      i64.extend_i32_s
      local.get $10
      local.get $24
      i32.sub
      i64.extend_i32_s
      i64.mul
      local.get $3
      i64.extend_i32_s
      i32.const 0
      local.get $24
      i32.sub
      i64.extend_i32_s
      i64.mul
      i64.add
      i64.add
      i64.add
     end
     local.set $18
     local.get $20
     local.get $21
     i64.add
     local.set $19
     local.get $18
     local.get $27
     i64.extend_i32_s
     local.tee $18
     i64.div_s
     local.set $21
     local.get $19
     local.get $18
     i64.div_s
     local.set $20
     local.get $23
     local.get $18
     i64.div_s
     local.tee $19
     local.get $14
     local.get $18
     i64.div_s
     local.tee $14
     i64.mul
     local.get $15
     local.get $18
     i64.div_s
     local.tee $18
     local.get $18
     i64.mul
     i64.sub
     local.tee $23
     i64.eqz
     if
      i32.const 1
      local.set $28
      br $for-break0
     end
     block $__inlined_func$assembly/comparative-effect/satI32$2 (result i32)
      i32.const -1073741824
      local.get $14
      local.get $21
      i64.mul
      local.get $18
      local.get $20
      i64.mul
      i64.sub
      local.get $32
      i64.mul
      local.get $23
      i64.div_s
      local.tee $14
      i64.const -1073741824
      i64.lt_s
      br_if $__inlined_func$assembly/comparative-effect/satI32$2
      drop
      i32.const 1073741823
      local.get $14
      i64.const 1073741823
      i64.gt_s
      br_if $__inlined_func$assembly/comparative-effect/satI32$2
      drop
      local.get $14
      i32.wrap_i64
     end
     local.set $17
     block $__inlined_func$assembly/comparative-effect/satI32$3 (result i32)
      i32.const -1073741824
      local.get $19
      local.get $20
      i64.mul
      local.get $18
      local.get $21
      i64.mul
      i64.sub
      local.get $32
      i64.mul
      local.get $23
      i64.div_s
      local.tee $14
      i64.const -1073741824
      i64.lt_s
      br_if $__inlined_func$assembly/comparative-effect/satI32$3
      drop
      i32.const 1073741823
      local.get $14
      i64.const 1073741823
      i64.gt_s
      br_if $__inlined_func$assembly/comparative-effect/satI32$3
      drop
      local.get $14
      i32.wrap_i64
     end
     local.set $16
     block $__inlined_func$assembly/comparative-effect/satI32$4 (result i32)
      i32.const -1073741824
      local.get $31
      i64.extend_i32_s
      local.get $17
      i64.extend_i32_s
      i64.add
      local.tee $14
      i64.const -1073741824
      i64.lt_s
      br_if $__inlined_func$assembly/comparative-effect/satI32$4
      drop
      i32.const 1073741823
      local.get $14
      i64.const 1073741823
      i64.gt_s
      br_if $__inlined_func$assembly/comparative-effect/satI32$4
      drop
      local.get $14
      i32.wrap_i64
     end
     local.set $31
     block $__inlined_func$assembly/comparative-effect/satI32$5 (result i32)
      i32.const -1073741824
      local.get $30
      i64.extend_i32_s
      local.get $16
      i64.extend_i32_s
      i64.add
      local.tee $14
      i64.const -1073741824
      i64.lt_s
      br_if $__inlined_func$assembly/comparative-effect/satI32$5
      drop
      i32.const 1073741823
      local.get $14
      i64.const 1073741823
      i64.gt_s
      br_if $__inlined_func$assembly/comparative-effect/satI32$5
      drop
      local.get $14
      i32.wrap_i64
     end
     local.set $30
     i32.const 0
     local.get $16
     i32.sub
     local.get $16
     local.get $16
     i32.const 0
     i32.lt_s
     select
     i32.const 0
     i32.le_s
     if (result i32)
      i32.const 0
      local.get $17
      i32.sub
      local.get $17
      local.get $17
      i32.const 0
      i32.lt_s
      select
      i32.const 0
      i32.le_s
     else
      i32.const 0
     end
     br_if $for-break0
     local.get $29
     i32.const 1
     i32.add
     local.set $29
     br $for-loop|0
    end
   end
  end
  local.get $13
  local.get $31
  i32.store
  local.get $13
  local.get $30
  i32.store offset=4
  local.get $13
  local.get $28
  i32.store offset=8
  local.get $13
  local.get $25
  i64.store offset=16
  local.get $13
  local.get $15
  i64.store offset=24
  local.get $13
  local.get $15
  i64.store offset=32
 )
 (func $assembly/comparative-effect/run (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (result i32)
  (local $4 i64)
  (local $5 i64)
  (local $6 i64)
  (local $7 i32)
  (local $8 i64)
  (local $9 i32)
  (local $10 i64)
  (local $11 i64)
  (local $12 i32)
  (local $13 i32)
  (local $14 i32)
  (local $15 i32)
  (local $16 i32)
  (local $17 i32)
  (local $18 i32)
  (local $19 i32)
  (local $20 i64)
  (local $21 i32)
  (local $22 i32)
  (local $23 i32)
  (local $24 i32)
  (local $25 i32)
  (local $26 i32)
  (local $27 i32)
  (local $28 i32)
  (local $29 i32)
  (local $30 i32)
  local.get $1
  i32.const 0
  i32.le_s
  local.get $1
  i32.const 1048576
  i32.gt_s
  i32.or
  if
   i32.const 5
   i32.const 6
   local.get $1
   select
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
  local.get $0
  i32.load offset=16
  local.set $19
  local.get $0
  i32.load offset=20
  local.set $15
  local.get $0
  i32.load offset=28
  local.set $14
  local.get $0
  i32.load offset=8
  local.tee $21
  i32.const 2
  i32.lt_s
  local.get $0
  i32.load
  local.tee $18
  local.get $0
  i32.load offset=4
  local.tee $17
  i32.ge_s
  i32.or
  local.get $0
  i32.load offset=12
  local.tee $16
  i32.const 0
  i32.le_s
  i32.or
  local.get $0
  i32.load offset=24
  local.tee $27
  i32.const 0
  i32.le_s
  i32.or
  if
   i32.const 5
   return
  end
  local.get $3
  local.get $0
  i32.const 32
  i32.add
  local.tee $9
  local.get $21
  i32.const 2
  i32.shl
  i32.add
  local.tee $7
  local.get $1
  i32.const 3
  i32.mul
  i32.add
  i32.const 7
  i32.add
  i32.const -8
  i32.and
  local.tee $28
  i32.const 48
  i32.add
  i32.lt_s
  if
   i32.const 5
   return
  end
  loop $for-loop|0
   local.get $2
   local.get $30
   i32.gt_s
   if
    local.get $3
    i32.const 32
    i32.add
    local.get $30
    i32.const 4
    i32.shl
    i32.add
    local.tee $0
    i32.const 0
    i32.store
    local.get $0
    i32.const 0
    i32.store offset=4
    local.get $0
    i32.const 0
    i32.store offset=8
    local.get $0
    i32.const 0
    i32.store offset=12
    local.get $30
    i32.const 1
    i32.add
    local.set $30
    br $for-loop|0
   end
  end
  i32.const 0
  local.set $30
  loop $for-loop|1
   local.get $1
   local.get $30
   i32.gt_s
   if
    i32.const 1
    local.get $1
    local.get $7
    i32.add
    local.get $30
    i32.add
    i32.load8_u
    local.tee $0
    i32.const 1
    i32.ne
    i32.const 0
    local.get $0
    select
    i32.const 1
    local.get $7
    local.get $30
    i32.add
    i32.load8_u
    local.tee $13
    i32.const 1
    i32.ne
    i32.const 0
    local.get $13
    select
    local.get $7
    local.get $1
    i32.const 1
    i32.shl
    i32.add
    local.get $30
    i32.add
    i32.load8_u
    local.tee $12
    local.get $2
    i32.ge_s
    select
    select
    if
     i32.const 3
     return
    end
    local.get $0
    i32.const 1
    i32.eq
    local.get $13
    i32.const 1
    i32.eq
    i32.and
    if (result i32)
     i32.const 0
    else
     local.get $0
     i32.eqz
     local.get $13
     i32.const 1
     i32.eq
     i32.and
     if (result i32)
      i32.const 4
     else
      i32.const 8
      i32.const 12
      local.get $13
      i32.eqz
      local.get $0
      i32.const 1
      i32.eq
      i32.and
      select
     end
    end
    local.get $3
    i32.const 32
    i32.add
    local.get $12
    i32.const 4
    i32.shl
    i32.add
    i32.add
    local.tee $0
    local.get $0
    i32.load
    i32.const 1
    i32.add
    i32.store
    local.get $30
    i32.const 1
    i32.add
    local.set $30
    br $for-loop|1
   end
  end
  i32.const 0
  local.set $30
  i32.const 0
  local.set $1
  loop $for-loop|2
   local.get $1
   local.get $2
   i32.lt_s
   if
    local.get $30
    local.get $3
    i32.const 32
    i32.add
    local.get $1
    i32.const 4
    i32.shl
    i32.add
    local.tee $0
    i32.load
    i32.add
    local.set $30
    local.get $24
    local.get $0
    i32.load offset=4
    i32.add
    local.set $24
    local.get $23
    local.get $0
    i32.load offset=8
    i32.add
    local.set $23
    local.get $29
    local.get $0
    i32.load offset=12
    i32.add
    local.set $29
    local.get $1
    i32.const 1
    i32.add
    local.set $1
    br $for-loop|2
   end
  end
  local.get $30
  local.get $24
  local.get $23
  local.get $29
  local.get $9
  local.get $21
  local.get $18
  local.get $17
  local.get $16
  i32.const 0
  local.get $27
  local.get $15
  local.get $19
  local.get $28
  call $assembly/comparative-effect/newton
  i32.const 1
  local.get $27
  i32.const 10
  i32.mul
  i32.const 0
  local.get $28
  i32.load offset=4
  local.tee $1
  i32.sub
  local.get $1
  local.get $1
  i32.const 0
  i32.lt_s
  select
  i32.le_s
  local.get $28
  i32.load offset=8
  select
  if
   local.get $30
   local.get $24
   local.get $23
   local.get $29
   local.get $9
   local.get $21
   local.get $18
   local.get $17
   local.get $16
   i32.const 1
   local.get $27
   local.get $15
   local.get $19
   local.get $28
   call $assembly/comparative-effect/newton
   i32.const 1
   local.set $26
   local.get $28
   i32.load offset=4
   local.set $1
  end
  i32.const 0
  local.set $0
  local.get $14
  i64.extend_i32_s
  local.get $28
  i64.load offset=16
  local.get $24
  local.get $30
  i32.add
  local.get $23
  i32.add
  local.get $29
  i32.add
  i64.extend_i32_s
  local.tee $8
  i64.div_s
  local.tee $11
  local.get $28
  i64.load offset=32
  local.get $8
  i64.div_s
  local.tee $6
  i64.mul
  local.get $28
  i64.load offset=24
  local.get $8
  i64.div_s
  local.tee $5
  local.get $5
  i64.mul
  i64.sub
  local.tee $20
  i64.const 0
  i64.ne
  local.get $8
  i64.const 0
  i64.gt_s
  i32.and
  if (result i32)
   block $__inlined_func$assembly/comparative-effect/satI32$7 (result i32)
    i32.const -1073741824
    local.get $6
    local.get $27
    i64.extend_i32_s
    local.tee $6
    i64.mul
    local.get $6
    i64.mul
    local.get $20
    i64.div_s
    local.get $8
    i64.div_s
    local.tee $10
    i64.const -1073741824
    i64.lt_s
    br_if $__inlined_func$assembly/comparative-effect/satI32$7
    drop
    i32.const 1073741823
    local.get $10
    i64.const 1073741823
    i64.gt_s
    br_if $__inlined_func$assembly/comparative-effect/satI32$7
    drop
    local.get $10
    i32.wrap_i64
   end
   local.set $22
   block $__inlined_func$assembly/comparative-effect/satI32$8 (result i32)
    i32.const -1073741824
    i64.const 0
    local.get $5
    local.get $6
    i64.mul
    local.get $6
    i64.mul
    i64.sub
    local.get $20
    i64.div_s
    local.get $8
    i64.div_s
    local.tee $5
    i64.const -1073741824
    i64.lt_s
    br_if $__inlined_func$assembly/comparative-effect/satI32$8
    drop
    i32.const 1073741823
    local.get $5
    i64.const 1073741823
    i64.gt_s
    br_if $__inlined_func$assembly/comparative-effect/satI32$8
    drop
    local.get $5
    i32.wrap_i64
   end
   local.set $0
   block $__inlined_func$assembly/comparative-effect/satI32$11 (result i32)
    block $__inlined_func$assembly/comparative-effect/satI32$9 (result i32)
     i32.const -1073741824
     local.get $6
     local.get $11
     i64.mul
     local.get $6
     i64.mul
     local.get $20
     i64.div_s
     local.get $8
     i64.div_s
     local.tee $5
     i64.const -1073741824
     i64.lt_s
     br_if $__inlined_func$assembly/comparative-effect/satI32$9
     drop
     i32.const 1073741823
     local.get $5
     i64.const 1073741823
     i64.gt_s
     br_if $__inlined_func$assembly/comparative-effect/satI32$9
     drop
     local.get $5
     i32.wrap_i64
    end
    local.tee $25
    i64.extend_i32_s
    local.get $27
    i64.extend_i32_s
    i64.mul
    local.tee $6
    i64.const 0
    i64.gt_s
    if
     local.get $6
     local.tee $4
     i64.const 1
     i64.add
     i64.const 2
     i64.div_s
     local.set $5
     loop $while-continue|0
      local.get $4
      local.get $5
      i64.gt_s
      if
       local.get $5
       local.tee $4
       local.get $6
       local.get $4
       i64.div_s
       i64.add
       i64.const 2
       i64.div_s
       local.set $5
       br $while-continue|0
      end
     end
    end
    i32.const -1073741824
    local.get $4
    i64.const -1073741824
    i64.lt_s
    br_if $__inlined_func$assembly/comparative-effect/satI32$11
    drop
    i32.const 1073741823
    local.get $4
    i64.const 1073741823
    i64.gt_s
    br_if $__inlined_func$assembly/comparative-effect/satI32$11
    drop
    local.get $4
    i32.wrap_i64
   end
  else
   i32.const 0
  end
  local.tee $7
  i64.extend_i32_s
  i64.mul
  local.get $27
  i64.extend_i32_s
  i64.div_s
  i32.wrap_i64
  local.set $2
  local.get $3
  local.get $26
  i32.store
  local.get $3
  local.get $1
  i32.store offset=4
  local.get $3
  local.get $7
  i32.store offset=8
  local.get $3
  local.get $22
  i32.store offset=12
  local.get $3
  local.get $0
  i32.store offset=16
  local.get $3
  local.get $25
  i32.store offset=20
  local.get $3
  block $__inlined_func$assembly/comparative-effect/satI32$12 (result i32)
   i32.const -1073741824
   local.get $1
   i64.extend_i32_s
   local.get $2
   i64.extend_i32_s
   i64.sub
   local.tee $4
   i64.const -1073741824
   i64.lt_s
   br_if $__inlined_func$assembly/comparative-effect/satI32$12
   drop
   i32.const 1073741823
   local.get $4
   i64.const 1073741823
   i64.gt_s
   br_if $__inlined_func$assembly/comparative-effect/satI32$12
   drop
   local.get $4
   i32.wrap_i64
  end
  i32.store offset=24
  local.get $3
  block $__inlined_func$assembly/comparative-effect/satI32$13 (result i32)
   i32.const -1073741824
   local.get $1
   i64.extend_i32_s
   local.get $2
   i64.extend_i32_s
   i64.add
   local.tee $4
   i64.const -1073741824
   i64.lt_s
   br_if $__inlined_func$assembly/comparative-effect/satI32$13
   drop
   i32.const 1073741823
   local.get $4
   i64.const 1073741823
   i64.gt_s
   br_if $__inlined_func$assembly/comparative-effect/satI32$13
   drop
   local.get $4
   i32.wrap_i64
  end
  i32.store offset=28
  i32.const 0
 )
)

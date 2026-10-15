(module
 (type $0 (func (param i32 i32 i32 i32) (result i32)))
 (import "env" "memory" (memory $0 1 1024))
 (global $assembly/algorithm-validation/abi_version i32 (i32.const 1))
 (export "abi_version" (global $assembly/algorithm-validation/abi_version))
 (export "run" (func $assembly/algorithm-validation/run))
 (export "memory" (memory $0))
 (func $assembly/algorithm-validation/run (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (result i32)
  (local $4 i64)
  (local $5 i64)
  (local $6 i32)
  (local $7 i64)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  (local $12 i32)
  (local $13 i32)
  (local $14 i32)
  (local $15 i32)
  (local $16 i32)
  (local $17 i32)
  (local $18 i32)
  (local $19 i32)
  (local $20 i32)
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
  (local $31 i32)
  (local $32 i32)
  (local $33 i32)
  (local $34 i64)
  (local $35 i64)
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
  local.tee $13
  i32.const 1
  i32.le_s
  local.get $0
  i32.load
  local.tee $9
  i32.const 0
  i32.le_s
  i32.or
  local.get $0
  i32.load offset=8
  local.tee $14
  i32.const 5
  i32.ne
  i32.or
  local.get $0
  i32.load offset=12
  local.tee $25
  i32.const 9
  i32.ne
  i32.or
  if
   i32.const 5
   return
  end
  local.get $3
  local.get $0
  i32.const 16
  i32.add
  local.tee $17
  local.get $1
  i32.const 3
  i32.shl
  i32.add
  i32.const 7
  i32.add
  i32.const -8
  i32.and
  i32.lt_s
  if
   i32.const 5
   return
  end
  i32.const 0
  local.set $0
  i32.const 0
  local.set $2
  loop $for-loop|0
   local.get $1
   local.get $12
   i32.gt_s
   if
    local.get $17
    local.get $12
    i32.const 3
    i32.shl
    i32.add
    local.tee $6
    i32.load8_u
    local.set $33
    i32.const 1
    local.get $13
    local.get $6
    i32.load offset=4
    local.tee $32
    i32.lt_s
    i32.const 1
    local.get $32
    i32.const 0
    i32.lt_s
    local.get $33
    i32.const 1
    i32.ne
    i32.const 0
    local.get $33
    select
    select
    select
    if
     i32.const 3
     return
    end
    local.get $33
    i32.const 1
    i32.eq
    if
     local.get $15
     i32.const 1
     i32.add
     local.set $15
    else
     local.get $16
     i32.const 1
     i32.add
     local.set $16
    end
    local.get $32
    i64.extend_i32_s
    local.get $14
    i64.extend_i32_s
    i64.mul
    local.get $13
    i64.extend_i32_s
    i64.div_s
    i32.wrap_i64
    local.tee $6
    local.get $14
    i32.ge_s
    if
     local.get $14
     i32.const 1
     i32.sub
     local.set $6
    end
    local.get $6
    if
     local.get $6
     i32.const 1
     i32.eq
     if
      local.get $2
      i32.const 1
      i32.add
      local.set $2
      local.get $26
      local.get $32
      i32.add
      local.set $26
      local.get $19
      i32.const 1
      i32.add
      local.get $19
      local.get $33
      i32.const 1
      i32.eq
      select
      local.set $19
     else
      local.get $6
      i32.const 2
      i32.eq
      if
       local.get $10
       i32.const 1
       i32.add
       local.set $10
       local.get $27
       local.get $32
       i32.add
       local.set $27
       local.get $20
       i32.const 1
       i32.add
       local.get $20
       local.get $33
       i32.const 1
       i32.eq
       select
       local.set $20
      else
       local.get $6
       i32.const 3
       i32.eq
       if
        local.get $11
        i32.const 1
        i32.add
        local.set $11
        local.get $28
        local.get $32
        i32.add
        local.set $28
        local.get $21
        i32.const 1
        i32.add
        local.get $21
        local.get $33
        i32.const 1
        i32.eq
        select
        local.set $21
       else
        local.get $18
        i32.const 1
        i32.add
        local.set $18
        local.get $29
        local.get $32
        i32.add
        local.set $29
        local.get $22
        i32.const 1
        i32.add
        local.get $22
        local.get $33
        i32.const 1
        i32.eq
        select
        local.set $22
       end
      end
     end
    else
     local.get $0
     i32.const 1
     i32.add
     local.set $0
     local.get $30
     local.get $32
     i32.add
     local.set $30
     local.get $23
     i32.const 1
     i32.add
     local.get $23
     local.get $33
     i32.const 1
     i32.eq
     select
     local.set $23
    end
    local.get $12
    i32.const 1
    i32.add
    local.set $12
    br $for-loop|0
   end
  end
  loop $for-loop|1
   local.get $1
   local.get $8
   i32.gt_s
   if
    local.get $17
    local.get $8
    i32.const 3
    i32.shl
    i32.add
    local.tee $6
    i32.load8_u
    i32.const 1
    i32.eq
    if
     local.get $6
     i32.load offset=4
     local.set $12
     i32.const 0
     local.set $6
     loop $for-loop|2
      local.get $1
      local.get $6
      i32.gt_s
      if
       local.get $17
       local.get $6
       i32.const 3
       i32.shl
       i32.add
       local.tee $32
       i32.load8_u
       i32.eqz
       if
        local.get $32
        i32.load offset=4
        local.tee $32
        local.get $12
        i32.lt_s
        if
         local.get $31
         i32.const 1
         i32.add
         local.set $31
        else
         local.get $24
         i32.const 1
         i32.add
         local.get $24
         local.get $12
         local.get $32
         i32.eq
         select
         local.set $24
        end
       end
       local.get $6
       i32.const 1
       i32.add
       local.set $6
       br $for-loop|2
      end
     end
    end
    local.get $8
    i32.const 1
    i32.add
    local.set $8
    br $for-loop|1
   end
  end
  block $__inlined_func$assembly/algorithm-validation/storeBin$1
   local.get $1
   local.get $9
   i32.lt_s
   local.get $0
   local.get $9
   i32.lt_s
   i32.or
   if
    local.get $3
    i32.const 0
    i32.store offset=32
    local.get $3
    i32.const 0
    i32.store offset=36
    local.get $3
    i32.const 0
    i32.store offset=40
    local.get $3
    i32.const 1
    i32.store offset=44
    br $__inlined_func$assembly/algorithm-validation/storeBin$1
   end
   local.get $3
   local.get $0
   i32.store offset=32
   local.get $3
   local.get $23
   i32.store offset=36
   local.get $3
   local.get $30
   local.get $0
   i32.div_s
   i32.store offset=40
   local.get $3
   i32.const 0
   i32.store offset=44
  end
  block $__inlined_func$assembly/algorithm-validation/storeBin$2
   local.get $1
   local.get $9
   i32.lt_s
   local.get $2
   local.get $9
   i32.lt_s
   i32.or
   if
    local.get $3
    i32.const 0
    i32.store offset=48
    local.get $3
    i32.const 0
    i32.store offset=52
    local.get $3
    i32.const 0
    i32.store offset=56
    local.get $3
    i32.const 1
    i32.store offset=60
    br $__inlined_func$assembly/algorithm-validation/storeBin$2
   end
   local.get $3
   local.get $2
   i32.store offset=48
   local.get $3
   local.get $19
   i32.store offset=52
   local.get $3
   local.get $26
   local.get $2
   i32.div_s
   i32.store offset=56
   local.get $3
   i32.const 0
   i32.store offset=60
  end
  local.get $3
  i32.const -64
  i32.sub
  local.set $0
  block $__inlined_func$assembly/algorithm-validation/storeBin$3
   local.get $1
   local.get $9
   i32.lt_s
   local.get $9
   local.get $10
   i32.gt_s
   i32.or
   if
    local.get $0
    i32.const 0
    i32.store
    local.get $0
    i32.const 0
    i32.store offset=4
    local.get $0
    i32.const 0
    i32.store offset=8
    local.get $0
    i32.const 1
    i32.store offset=12
    br $__inlined_func$assembly/algorithm-validation/storeBin$3
   end
   local.get $0
   local.get $10
   i32.store
   local.get $0
   local.get $20
   i32.store offset=4
   local.get $0
   local.get $27
   local.get $10
   i32.div_s
   i32.store offset=8
   local.get $0
   i32.const 0
   i32.store offset=12
  end
  block $__inlined_func$assembly/algorithm-validation/storeBin$4
   local.get $1
   local.get $9
   i32.lt_s
   local.get $9
   local.get $11
   i32.gt_s
   i32.or
   if
    local.get $3
    i32.const 0
    i32.store offset=80
    local.get $3
    i32.const 0
    i32.store offset=84
    local.get $3
    i32.const 0
    i32.store offset=88
    local.get $3
    i32.const 1
    i32.store offset=92
    br $__inlined_func$assembly/algorithm-validation/storeBin$4
   end
   local.get $3
   local.get $11
   i32.store offset=80
   local.get $3
   local.get $21
   i32.store offset=84
   local.get $3
   local.get $28
   local.get $11
   i32.div_s
   i32.store offset=88
   local.get $3
   i32.const 0
   i32.store offset=92
  end
  block $__inlined_func$assembly/algorithm-validation/storeBin$5
   local.get $1
   local.get $9
   i32.lt_s
   local.get $9
   local.get $18
   i32.gt_s
   i32.or
   if
    local.get $3
    i32.const 0
    i32.store offset=96
    local.get $3
    i32.const 0
    i32.store offset=100
    local.get $3
    i32.const 0
    i32.store offset=104
    local.get $3
    i32.const 1
    i32.store offset=108
    br $__inlined_func$assembly/algorithm-validation/storeBin$5
   end
   local.get $3
   local.get $18
   i32.store offset=96
   local.get $3
   local.get $22
   i32.store offset=100
   local.get $3
   local.get $29
   local.get $18
   i32.div_s
   i32.store offset=104
   local.get $3
   i32.const 0
   i32.store offset=108
  end
  i32.const 1
  local.set $0
  loop $for-loop|3
   local.get $0
   local.get $25
   i32.le_s
   if
    i32.const 0
    local.set $10
    i32.const 0
    local.set $11
    i32.const 0
    local.set $2
    loop $for-loop|4
     local.get $1
     local.get $2
     i32.gt_s
     if
      local.get $17
      local.get $2
      i32.const 3
      i32.shl
      i32.add
      local.tee $6
      i64.load32_s offset=4
      i64.const 10
      i64.mul
      local.get $0
      i64.extend_i32_s
      local.get $13
      i64.extend_i32_s
      i64.mul
      i64.ge_s
      if
       local.get $6
       i32.load8_u
       i32.const 1
       i32.eq
       if
        local.get $10
        i32.const 1
        i32.add
        local.set $10
       else
        local.get $11
        i32.const 1
        i32.add
        local.set $11
       end
      end
      local.get $2
      i32.const 1
      i32.add
      local.set $2
      br $for-loop|4
     end
    end
    local.get $14
    i32.const 4
    i32.shl
    local.get $3
    i32.add
    local.get $0
    i32.const 4
    i32.shl
    i32.add
    local.tee $2
    i32.const 16
    i32.add
    local.get $0
    i32.store
    local.get $2
    i32.const 0
    i32.store offset=28
    local.get $1
    local.get $9
    i32.lt_s
    local.get $10
    local.get $11
    i32.add
    local.get $9
    i32.lt_s
    i32.or
    if
     local.get $2
     i32.const 0
     i32.store offset=20
     local.get $2
     i32.const 1
     i32.store offset=24
    else
     local.get $2
     block $__inlined_func$assembly/algorithm-validation/satI32$6 (result i32)
      i32.const -2147483648
      local.get $13
      i64.extend_i32_s
      local.tee $5
      local.get $10
      i64.extend_i32_s
      i64.mul
      local.get $1
      i64.extend_i32_s
      local.tee $7
      i64.div_s
      local.get $0
      i64.extend_i32_s
      local.tee $34
      local.get $11
      i64.extend_i32_s
      local.get $5
      i64.mul
      i64.mul
      local.get $7
      i64.const 10
      local.get $34
      i64.sub
      i64.mul
      i64.div_s
      i64.sub
      local.tee $5
      i64.const -2147483648
      i64.lt_s
      br_if $__inlined_func$assembly/algorithm-validation/satI32$6
      drop
      i32.const 2147483647
      local.get $5
      i64.const 2147483647
      i64.gt_s
      br_if $__inlined_func$assembly/algorithm-validation/satI32$6
      drop
      local.get $5
      i32.wrap_i64
     end
     i32.store offset=20
     local.get $2
     i32.const 0
     i32.store offset=24
    end
    local.get $0
    i32.const 1
    i32.add
    local.set $0
    br $for-loop|3
   end
  end
  local.get $3
  local.get $15
  i32.store offset=12
  local.get $3
  local.get $16
  i32.store offset=16
  local.get $3
  local.get $14
  i32.store offset=20
  local.get $3
  local.get $25
  i32.store offset=24
  local.get $3
  i32.const 0
  i32.store offset=28
  local.get $16
  i32.eqz
  local.get $15
  i32.eqz
  local.get $1
  local.get $9
  i32.lt_s
  i32.or
  i32.or
  if
   local.get $3
   i32.const 1
   i32.store
   local.get $3
   i32.const 0
   i32.store offset=4
   local.get $3
   i32.const 0
   i32.store offset=8
   i32.const 0
   return
  end
  local.get $15
  i32.const 1
  i32.sub
  i64.extend_i32_s
  local.get $13
  i64.extend_i32_s
  local.tee $7
  local.get $24
  i64.extend_i32_s
  local.get $31
  i64.extend_i32_s
  i64.const 1
  i64.shl
  i64.add
  i64.mul
  local.get $16
  i64.extend_i32_s
  local.tee $34
  local.get $15
  i64.extend_i32_s
  local.tee $35
  i64.const 1
  i64.shl
  i64.mul
  i64.div_s
  local.tee $5
  local.get $7
  i64.mul
  local.get $7
  i64.const 1
  i64.shl
  local.get $5
  i64.sub
  i64.div_s
  i64.mul
  local.get $7
  i64.add
  local.get $16
  i32.const 1
  i32.sub
  i64.extend_i32_s
  local.get $5
  i64.const 1
  i64.shl
  local.get $5
  i64.mul
  local.get $5
  local.get $7
  i64.add
  i64.div_s
  i64.mul
  i64.add
  local.get $5
  local.get $7
  local.get $5
  i64.sub
  i64.mul
  i64.mul
  local.get $34
  local.get $7
  local.get $35
  i64.mul
  i64.mul
  i64.div_s
  local.set $7
  local.get $3
  i32.const 0
  i32.store
  local.get $3
  block $__inlined_func$assembly/algorithm-validation/satI32$7 (result i32)
   i32.const -2147483648
   local.get $5
   i64.const -2147483648
   i64.lt_s
   br_if $__inlined_func$assembly/algorithm-validation/satI32$7
   drop
   i32.const 2147483647
   local.get $5
   i64.const 2147483647
   i64.gt_s
   br_if $__inlined_func$assembly/algorithm-validation/satI32$7
   drop
   local.get $5
   i32.wrap_i64
  end
  i32.store offset=4
  local.get $3
  block $__inlined_func$assembly/algorithm-validation/satI32$9 (result i32)
   local.get $7
   i64.const 0
   i64.gt_s
   if
    local.get $7
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
      local.get $7
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
   i32.const -2147483648
   local.get $4
   i64.const -2147483648
   i64.lt_s
   br_if $__inlined_func$assembly/algorithm-validation/satI32$9
   drop
   i32.const 2147483647
   local.get $4
   i64.const 2147483647
   i64.gt_s
   br_if $__inlined_func$assembly/algorithm-validation/satI32$9
   drop
   local.get $4
   i32.wrap_i64
  end
  i32.store offset=8
  i32.const 0
 )
)

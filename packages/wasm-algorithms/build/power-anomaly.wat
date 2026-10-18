(module
 (type $0 (func (param i32 i32 i32 i32)))
 (type $1 (func (param i32 i32 i32 i32 i32 i32) (result i32)))
 (type $2 (func (param i32 i32 i32 i32) (result i32)))
 (import "env" "memory" (memory $0 1 1024))
 (global $assembly/power-anomaly/abi_version i32 (i32.const 1))
 (export "abi_version" (global $assembly/power-anomaly/abi_version))
 (export "run" (func $assembly/power-anomaly/run))
 (export "memory" (memory $0))
 (func $assembly/power-anomaly/meanStd (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32)
  (local $4 i32)
  (local $5 i64)
  (local $6 i64)
  (local $7 i64)
  (local $8 i64)
  local.get $2
  local.get $1
  i32.sub
  i64.extend_i32_s
  local.set $8
  local.get $1
  local.set $4
  loop $for-loop|0
   local.get $2
   local.get $4
   i32.gt_s
   if
    local.get $5
    local.get $0
    local.get $4
    i32.const 2
    i32.shl
    i32.add
    i64.load32_s
    i64.add
    local.set $5
    local.get $4
    i32.const 1
    i32.add
    local.set $4
    br $for-loop|0
   end
  end
  local.get $5
  local.get $8
  i64.div_s
  local.set $5
  loop $for-loop|1
   local.get $1
   local.get $2
   i32.lt_s
   if
    local.get $6
    local.get $0
    local.get $1
    i32.const 2
    i32.shl
    i32.add
    i64.load32_s
    local.get $5
    i64.sub
    local.tee $6
    local.get $6
    i64.mul
    i64.add
    local.set $6
    local.get $1
    i32.const 1
    i32.add
    local.set $1
    br $for-loop|1
   end
  end
  local.get $3
  local.get $5
  i64.store32
  local.get $3
  local.get $6
  local.get $8
  i64.div_s
  local.tee $6
  i64.const 0
  i64.le_s
  if (result i64)
   i64.const 0
  else
   i64.const 4611686018427387904
   local.set $5
   loop $while-continue|0
    local.get $5
    local.get $6
    i64.gt_s
    if
     local.get $5
     i64.const 2
     i64.shr_s
     local.set $5
     br $while-continue|0
    end
   end
   loop $while-continue|1
    local.get $5
    i64.const 0
    i64.ne
    if
     local.get $5
     local.get $7
     i64.add
     local.tee $8
     local.get $6
     i64.le_s
     if (result i64)
      local.get $6
      local.get $8
      i64.sub
      local.set $6
      local.get $7
      i64.const 1
      i64.shr_s
      local.get $5
      i64.add
     else
      local.get $7
      i64.const 1
      i64.shr_s
     end
     local.set $7
     local.get $5
     i64.const 2
     i64.shr_s
     local.set $5
     br $while-continue|1
    end
   end
   local.get $7
  end
  i64.store32 offset=4
 )
 (func $assembly/power-anomaly/ruleFeatures (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32)
  (local $4 i32)
  (local $5 i32)
  (local $6 i64)
  (local $7 i64)
  (local $8 i64)
  (local $9 i64)
  (local $10 i32)
  (local $11 i64)
  (local $12 i64)
  (local $13 i64)
  (local $14 i64)
  (local $15 i64)
  (local $16 i32)
  (local $17 i64)
  (local $18 i32)
  (local $19 i32)
  local.get $0
  i32.const 0
  local.get $1
  local.get $3
  i32.const 40
  i32.add
  call $assembly/power-anomaly/meanStd
  i64.const 1
  local.get $3
  i64.load32_s offset=44
  local.tee $7
  local.get $7
  i64.const 0
  i64.le_s
  select
  local.set $8
  local.get $2
  i64.extend_i32_s
  local.get $3
  i64.load32_s offset=40
  local.tee $15
  local.get $2
  i32.const 0
  i32.gt_s
  select
  local.set $7
  i32.const -1
  local.set $4
  i32.const -1
  local.set $10
  i32.const 0
  local.set $2
  loop $for-loop|0
   local.get $1
   local.get $2
   i32.gt_s
   if
    local.get $0
    local.get $2
    i32.const 2
    i32.shl
    i32.add
    i32.load
    local.tee $16
    if (result i32)
     i32.const 0
    else
     local.get $11
     i64.const 1
     i64.add
     local.set $11
     i32.const 1
    end
    local.set $5
    local.get $16
    i32.const 0
    i32.lt_s
    if
     local.get $12
     i64.const 1
     i64.add
     local.set $12
     i32.const 1
     local.set $5
    end
    local.get $2
    i32.const 0
    i32.gt_s
    if
     i64.const 0
     local.get $16
     i64.extend_i32_s
     local.get $0
     local.get $2
     i32.const 1
     i32.sub
     i32.const 2
     i32.shl
     i32.add
     i64.load32_s
     i64.sub
     local.tee $17
     i64.sub
     local.get $17
     local.get $17
     i64.const 0
     i64.lt_s
     select
     local.tee $17
     local.get $8
     i64.const 2
     i64.shl
     i64.gt_s
     if (result i32)
      local.get $17
      i64.const 1
      i64.shl
      i64.const 0
      local.get $15
      i64.sub
      local.get $15
      local.get $15
      i64.const 0
      i64.lt_s
      select
      i64.gt_s
     else
      i32.const 0
     end
     if
      local.get $13
      i64.const 1
      i64.add
      local.set $13
      i32.const 1
      local.set $5
     end
    end
    local.get $16
    i32.const 0
    i32.ge_s
    if (result i32)
     local.get $16
     i64.extend_i32_s
     i64.const 5
     i64.mul
     local.get $7
     i64.lt_s
    else
     i32.const 0
    end
    if (result i32)
     local.get $14
     i64.const 1
     i64.add
     local.set $14
     i32.const 1
    else
     local.get $5
    end
    if
     local.get $2
     i32.const 1
     i32.add
     local.set $10
     local.get $2
     local.get $4
     local.get $4
     i32.const 0
     i32.lt_s
     select
     local.set $4
    end
    local.get $2
    i32.const 1
    i32.add
    local.set $2
    br $for-loop|0
   end
  end
  i32.const 0
  local.set $2
  loop $for-loop|1
   local.get $2
   i32.const 24
   i32.lt_s
   if
    i64.const 0
    local.set $7
    i64.const 0
    local.set $8
    local.get $2
    local.set $5
    loop $for-loop|2
     local.get $1
     local.get $5
     i32.gt_s
     if
      local.get $7
      i64.const 1
      i64.add
      local.set $7
      local.get $8
      local.get $8
      i64.const 1
      i64.add
      local.get $0
      local.get $5
      i32.const 2
      i32.shl
      i32.add
      i32.load
      select
      local.set $8
      local.get $5
      i32.const 24
      i32.add
      local.set $5
      br $for-loop|2
     end
    end
    local.get $7
    i64.const 0
    i64.gt_s
    if (result i64)
     local.get $8
     i64.const 1000
     i64.mul
     local.get $7
     i64.div_s
    else
     i64.const 0
    end
    local.tee $7
    local.get $9
    i64.add
    local.set $9
    local.get $7
    local.get $6
    local.get $6
    local.get $7
    i64.lt_s
    select
    local.set $6
    local.get $2
    i32.const 1
    i32.add
    local.set $2
    br $for-loop|1
   end
  end
  block $__inlined_func$assembly/power-anomaly/clampPermille$3 (result i32)
   i32.const 0
   local.get $6
   local.get $9
   i64.const 24
   i64.div_s
   i64.sub
   local.tee $6
   i64.const 0
   i64.lt_s
   br_if $__inlined_func$assembly/power-anomaly/clampPermille$3
   drop
   i32.const 1000
   local.get $6
   i64.const 1000
   i64.gt_s
   br_if $__inlined_func$assembly/power-anomaly/clampPermille$3
   drop
   local.get $6
   i32.wrap_i64
  end
  local.set $16
  i64.const 1
  local.get $1
  i32.const 50
  i32.div_s
  local.tee $0
  i64.extend_i32_s
  local.get $0
  i32.const 0
  i32.le_s
  select
  local.set $6
  block $__inlined_func$assembly/power-anomaly/clampPermille$4 (result i32)
   i32.const 0
   local.get $11
   i64.const 1000
   i64.mul
   local.get $1
   i64.extend_i32_s
   i64.div_s
   local.tee $7
   i64.const 0
   i64.lt_s
   br_if $__inlined_func$assembly/power-anomaly/clampPermille$4
   drop
   i32.const 1000
   local.get $7
   i64.const 1000
   i64.gt_s
   br_if $__inlined_func$assembly/power-anomaly/clampPermille$4
   drop
   local.get $7
   i32.wrap_i64
  end
  local.set $0
  block $__inlined_func$assembly/power-anomaly/clampPermille$5 (result i32)
   i32.const 0
   local.get $12
   i64.const 1000
   i64.mul
   local.get $6
   i64.div_s
   local.tee $7
   i64.const 0
   i64.lt_s
   br_if $__inlined_func$assembly/power-anomaly/clampPermille$5
   drop
   i32.const 1000
   local.get $7
   i64.const 1000
   i64.gt_s
   br_if $__inlined_func$assembly/power-anomaly/clampPermille$5
   drop
   local.get $7
   i32.wrap_i64
  end
  local.set $18
  block $__inlined_func$assembly/power-anomaly/clampPermille$6 (result i32)
   i32.const 0
   local.get $13
   i64.const 1000
   i64.mul
   local.get $6
   i64.div_s
   local.tee $6
   i64.const 0
   i64.lt_s
   br_if $__inlined_func$assembly/power-anomaly/clampPermille$6
   drop
   i32.const 1000
   local.get $6
   i64.const 1000
   i64.gt_s
   br_if $__inlined_func$assembly/power-anomaly/clampPermille$6
   drop
   local.get $6
   i32.wrap_i64
  end
  local.set $2
  block $__inlined_func$assembly/power-anomaly/clampPermille$7 (result i32)
   i32.const 0
   local.get $14
   i64.const 1000
   i64.mul
   local.get $1
   i64.extend_i32_s
   i64.div_s
   local.tee $6
   i64.const 0
   i64.lt_s
   br_if $__inlined_func$assembly/power-anomaly/clampPermille$7
   drop
   i32.const 1000
   local.get $6
   i64.const 1000
   i64.gt_s
   br_if $__inlined_func$assembly/power-anomaly/clampPermille$7
   drop
   local.get $6
   i32.wrap_i64
  end
  local.set $19
  local.get $3
  local.get $0
  i32.store
  local.get $3
  local.get $18
  i32.store offset=4
  local.get $3
  local.get $2
  i32.store offset=8
  local.get $3
  local.get $19
  i32.store offset=12
  local.get $3
  local.get $16
  i32.store offset=16
  i32.const 1
  local.set $5
  local.get $0
  local.get $18
  i32.lt_s
  if
   i32.const 2
   local.set $5
   local.get $18
   local.set $0
  end
  local.get $0
  local.get $2
  i32.lt_s
  if
   i32.const 3
   local.set $5
   local.get $2
   local.set $0
  end
  local.get $0
  local.get $19
  i32.lt_s
  if
   i32.const 4
   local.set $5
   local.get $19
   local.set $0
  end
  local.get $0
  local.get $16
  i32.lt_s
  if
   i32.const 5
   local.set $5
   local.get $16
   local.set $0
  end
  local.get $3
  local.get $5
  i32.const 0
  local.get $0
  i32.const 50
  i32.ge_s
  select
  i32.store offset=20
  local.get $4
  i32.const 0
  i32.ge_s
  if
   local.get $3
   local.get $4
   i32.store offset=24
   local.get $3
   local.get $10
   local.get $4
   i32.const 1
   i32.add
   local.tee $0
   local.get $0
   local.get $10
   i32.lt_s
   select
   i32.store offset=28
  else
   local.get $3
   i32.const 0
   i32.store offset=24
   local.get $3
   local.get $1
   i32.store offset=28
  end
 )
 (func $assembly/power-anomaly/windowVector (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32)
  (local $4 i64)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i64)
  (local $10 i32)
  (local $11 i64)
  (local $12 i64)
  local.get $0
  local.get $1
  local.get $2
  local.get $3
  call $assembly/power-anomaly/meanStd
  local.get $2
  local.get $1
  i32.sub
  local.set $10
  local.get $3
  i64.load32_s
  local.set $11
  i64.const 1
  local.get $3
  i64.load32_s offset=4
  local.tee $12
  local.get $12
  i64.const 0
  i64.le_s
  select
  local.set $12
  local.get $0
  local.get $1
  i32.const 2
  i32.shl
  i32.add
  i32.load
  local.tee $7
  local.set $8
  local.get $1
  local.set $5
  loop $for-loop|0
   local.get $2
   local.get $5
   i32.gt_s
   if
    local.get $9
    local.get $9
    i64.const 1
    i64.add
    local.get $0
    local.get $5
    i32.const 2
    i32.shl
    i32.add
    i32.load
    local.tee $6
    select
    local.set $9
    local.get $6
    local.get $7
    local.get $6
    local.get $7
    i32.lt_s
    select
    local.set $7
    local.get $6
    local.get $8
    local.get $6
    local.get $8
    i32.gt_s
    select
    local.set $8
    local.get $1
    local.get $5
    i32.lt_s
    if
     local.get $4
     i64.const 1
     i64.add
     local.get $4
     i64.const 0
     local.get $6
     i64.extend_i32_s
     local.get $0
     local.get $5
     i32.const 1
     i32.sub
     i32.const 2
     i32.shl
     i32.add
     i64.load32_s
     i64.sub
     local.tee $4
     i64.sub
     local.get $4
     local.get $4
     i64.const 0
     i64.lt_s
     select
     local.tee $4
     local.get $12
     i64.const 2
     i64.shl
     i64.gt_s
     if (result i32)
      local.get $4
      i64.const 1
      i64.shl
      i64.const 0
      local.get $11
      i64.sub
      local.get $11
      local.get $11
      i64.const 0
      i64.lt_s
      select
      i64.gt_s
     else
      i32.const 0
     end
     select
     local.set $4
    end
    local.get $5
    i32.const 1
    i32.add
    local.set $5
    br $for-loop|0
   end
  end
  i64.const 1
  local.get $10
  i32.const 50
  i32.div_s
  local.tee $0
  i64.extend_i32_s
  local.get $0
  i32.const 0
  i32.le_s
  select
  local.set $11
  local.get $3
  block $__inlined_func$assembly/power-anomaly/clampPermille$10 (result i32)
   i32.const 0
   local.get $9
   i64.const 1000
   i64.mul
   local.get $10
   i64.extend_i32_s
   i64.div_s
   local.tee $9
   i64.const 0
   i64.lt_s
   br_if $__inlined_func$assembly/power-anomaly/clampPermille$10
   drop
   i32.const 1000
   local.get $9
   i64.const 1000
   i64.gt_s
   br_if $__inlined_func$assembly/power-anomaly/clampPermille$10
   drop
   local.get $9
   i32.wrap_i64
  end
  i32.store offset=8
  local.get $3
  local.get $7
  i32.store offset=12
  local.get $3
  local.get $8
  i32.store offset=16
  local.get $3
  block $__inlined_func$assembly/power-anomaly/clampPermille$11 (result i32)
   i32.const 0
   local.get $4
   i64.const 1000
   i64.mul
   local.get $11
   i64.div_s
   local.tee $4
   i64.const 0
   i64.lt_s
   br_if $__inlined_func$assembly/power-anomaly/clampPermille$11
   drop
   i32.const 1000
   local.get $4
   i64.const 1000
   i64.gt_s
   br_if $__inlined_func$assembly/power-anomaly/clampPermille$11
   drop
   local.get $4
   i32.wrap_i64
  end
  i32.store offset=20
 )
 (func $assembly/power-anomaly/isolationScore (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32) (param $5 i32) (result i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i64)
  (local $11 i32)
  (local $12 i32)
  (local $13 i32)
  (local $14 i32)
  (local $15 i32)
  (local $16 i32)
  (local $17 i64)
  local.get $5
  i32.const 1
  local.get $5
  select
  local.set $16
  i32.const 2
  local.get $2
  local.get $2
  i32.const 2
  i32.lt_s
  select
  local.set $5
  loop $while-continue|0
   i32.const 1
   local.get $15
   i32.shl
   local.get $5
   i32.lt_s
   if
    local.get $15
    i32.const 1
    i32.add
    local.set $15
    br $while-continue|0
   end
  end
  i32.const 64
  local.get $2
  local.get $2
  i32.const 64
  i32.ge_s
  select
  local.set $9
  loop $for-loop|1
   local.get $4
   local.get $12
   i32.gt_s
   if
    i32.const 0
    local.set $5
    loop $for-loop|2
     local.get $5
     local.get $9
     i32.lt_s
     if
      local.get $3
      local.get $5
      i32.const 2
      i32.shl
      i32.add
      local.get $16
      i32.const 1664525
      i32.mul
      i32.const 1013904223
      i32.add
      local.tee $16
      local.get $2
      i32.rem_u
      i32.store
      local.get $5
      i32.const 1
      i32.add
      local.set $5
      br $for-loop|2
     end
    end
    local.get $9
    local.set $5
    i32.const 0
    local.set $14
    loop $while-continue|3
     local.get $14
     local.get $15
     i32.lt_s
     local.get $5
     i32.const 1
     i32.gt_s
     i32.and
     if
      block $while-break|3
       local.get $1
       local.get $16
       i32.const 1664525
       i32.mul
       i32.const 1013904223
       i32.add
       local.tee $16
       i32.const 6
       i32.rem_u
       local.tee $13
       local.get $3
       i32.load
       i32.const 6
       i32.mul
       i32.add
       i32.const 2
       i32.shl
       i32.add
       i32.load
       local.tee $7
       local.set $6
       i32.const 1
       local.set $11
       loop $for-loop|4
        local.get $5
        local.get $11
        i32.gt_s
        if
         local.get $1
         local.get $3
         local.get $11
         i32.const 2
         i32.shl
         i32.add
         i32.load
         i32.const 6
         i32.mul
         local.get $13
         i32.add
         i32.const 2
         i32.shl
         i32.add
         i32.load
         local.tee $8
         local.get $7
         i32.lt_s
         if
          local.get $8
          local.set $7
         end
         local.get $8
         local.get $6
         local.get $6
         local.get $8
         i32.lt_s
         select
         local.set $6
         local.get $11
         i32.const 1
         i32.add
         local.set $11
         br $for-loop|4
        end
       end
       local.get $6
       local.get $7
       i32.le_s
       br_if $while-break|3
       local.get $16
       i32.const 1664525
       i32.mul
       i32.const 1013904223
       i32.add
       local.tee $16
       i64.extend_i32_u
       local.get $6
       i64.extend_i32_s
       local.get $7
       i64.extend_i32_s
       local.tee $17
       i64.sub
       i64.mul
       i64.const 32
       i64.shr_s
       local.get $17
       i64.add
       local.tee $17
       local.get $0
       local.get $13
       i32.const 2
       i32.shl
       i32.add
       i64.load32_s
       i64.gt_s
       local.set $8
       i32.const 0
       local.set $6
       i32.const 0
       local.set $7
       loop $for-loop|5
        local.get $5
        local.get $7
        i32.gt_s
        if
         local.get $1
         local.get $3
         local.get $7
         i32.const 2
         i32.shl
         i32.add
         i32.load
         local.tee $11
         i32.const 6
         i32.mul
         local.get $13
         i32.add
         i32.const 2
         i32.shl
         i32.add
         i64.load32_s
         local.get $17
         i64.lt_s
         local.get $8
         i32.eq
         if
          local.get $3
          local.get $6
          i32.const 2
          i32.shl
          i32.add
          local.get $11
          i32.store
          local.get $6
          i32.const 1
          i32.add
          local.set $6
         end
         local.get $7
         i32.const 1
         i32.add
         local.set $7
         br $for-loop|5
        end
       end
       local.get $14
       i32.const 1
       i32.add
       local.set $14
       local.get $6
       i32.eqz
       local.get $5
       local.get $6
       i32.eq
       i32.or
       br_if $while-break|3
       local.get $6
       local.set $5
       br $while-continue|3
      end
     end
    end
    local.get $10
    local.get $14
    i64.extend_i32_s
    i64.add
    local.set $10
    local.get $12
    i32.const 1
    i32.add
    local.set $12
    br $for-loop|1
   end
  end
  block $__inlined_func$assembly/power-anomaly/clampPermille$15 (result i32)
   i32.const 0
   i64.const 1000
   local.get $10
   i64.const 2000
   i64.mul
   local.get $4
   i64.extend_i32_s
   i64.const 2
   local.get $15
   i64.extend_i32_s
   local.get $15
   i32.const 2
   i32.lt_s
   select
   i64.mul
   i64.div_s
   i64.sub
   local.tee $10
   i64.const 0
   i64.lt_s
   br_if $__inlined_func$assembly/power-anomaly/clampPermille$15
   drop
   i32.const 1000
   local.get $10
   i64.const 1000
   i64.gt_s
   br_if $__inlined_func$assembly/power-anomaly/clampPermille$15
   drop
   local.get $10
   i32.wrap_i64
  end
 )
 (func $assembly/power-anomaly/run (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (result i32)
  (local $4 i32)
  (local $5 i64)
  (local $6 i32)
  (local $7 i32)
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
  (local $18 i64)
  (local $19 i64)
  (local $20 i64)
  (local $21 i32)
  (local $22 i32)
  (local $23 i64)
  local.get $1
  i32.const 0
  i32.le_s
  local.get $1
  i32.const 65536
  i32.gt_s
  i32.or
  if
   i32.const 1
   return
  end
  local.get $2
  i32.const 24
  i32.ne
  if
   i32.const 2
   return
  end
  local.get $0
  i32.load
  local.set $11
  local.get $0
  i32.const 32
  i32.add
  local.tee $16
  local.get $1
  i32.const 2
  i32.shl
  i32.add
  local.tee $9
  local.get $1
  i32.const 1
  i32.add
  i32.const 2
  i32.shl
  i32.add
  local.set $12
  local.get $9
  i32.load
  local.tee $0
  if
   i32.const 5
   return
  end
  loop $for-loop|0
   local.get $1
   local.get $6
   i32.gt_s
   if
    local.get $9
    local.get $6
    i32.const 1
    i32.add
    i32.const 2
    i32.shl
    i32.add
    i32.load
    local.tee $2
    local.get $0
    i32.lt_u
    if
     i32.const 5
     return
    end
    local.get $2
    local.get $0
    i32.sub
    local.tee $0
    i32.const 0
    i32.le_s
    local.get $0
    i32.const 65536
    i32.gt_s
    i32.or
    if
     i32.const 3
     return
    end
    local.get $0
    i32.const 720
    i32.ge_s
    if
     local.get $0
     i32.const 168
     i32.sub
     i32.const 168
     i32.const 336
     local.get $0
     i32.const 1440
     i32.le_s
     select
     i32.div_s
     i32.const 1
     i32.add
     local.tee $0
     local.get $4
     i32.gt_s
     if
      local.get $0
      local.set $4
     end
    end
    local.get $2
    local.set $0
    local.get $6
    i32.const 1
    i32.add
    local.set $6
    br $for-loop|0
   end
  end
  local.get $3
  local.get $12
  local.get $0
  i32.const 2
  i32.shl
  i32.add
  i32.const 7
  i32.add
  i32.const -8
  i32.and
  local.tee $0
  local.get $4
  i32.const 6
  i32.mul
  i32.const 88
  i32.add
  i32.const 2
  i32.shl
  i32.add
  i32.lt_s
  if
   i32.const 6
   return
  end
  local.get $0
  i32.const -64
  i32.sub
  local.set $13
  local.get $0
  i32.const 96
  i32.add
  local.set $17
  local.get $0
  i32.const 352
  i32.add
  local.set $14
  i32.const 0
  local.set $6
  loop $for-loop|1
   local.get $1
   local.get $6
   i32.gt_s
   if
    local.get $9
    local.get $6
    i32.const 1
    i32.add
    i32.const 2
    i32.shl
    i32.add
    i32.load
    local.get $9
    local.get $6
    i32.const 2
    i32.shl
    i32.add
    i32.load
    local.tee $2
    i32.sub
    local.set $21
    local.get $12
    local.get $2
    i32.const 2
    i32.shl
    i32.add
    local.set $22
    i32.const 0
    local.set $4
    loop $for-loop|2
     local.get $4
     local.get $21
     i32.lt_s
     if
      local.get $22
      local.get $4
      i32.const 2
      i32.shl
      i32.add
      i32.load
      local.tee $2
      i32.const -5000000
      i32.lt_s
      local.get $2
      i32.const 5000000
      i32.gt_s
      i32.or
      if
       i32.const 4
       return
      end
      local.get $4
      i32.const 1
      i32.add
      local.set $4
      br $for-loop|2
     end
    end
    local.get $22
    local.get $21
    local.get $11
    local.get $0
    call $assembly/power-anomaly/ruleFeatures
    local.get $0
    i64.load32_s
    local.set $20
    local.get $0
    i64.load32_s offset=4
    local.set $23
    local.get $0
    i64.load32_s offset=8
    local.set $18
    local.get $0
    i64.load32_s offset=12
    local.set $5
    local.get $0
    i64.load32_s offset=16
    local.set $19
    local.get $0
    i32.load offset=20
    local.set $15
    i32.const 0
    local.set $4
    i32.const 6
    local.set $7
    i32.const 0
    local.set $10
    i32.const 200
    local.set $2
    i32.const 0
    local.set $8
    local.get $21
    i32.const 720
    i32.lt_s
    if (result i32)
     local.get $11
     i32.const 0
     i32.gt_s
     if (result i32)
      i32.const 6
      local.get $15
      block $__inlined_func$assembly/power-anomaly/clampPermille$17 (result i32)
       i32.const 0
       local.get $5
       local.get $23
       local.get $20
       local.get $20
       local.get $23
       i64.lt_s
       select
       local.tee $18
       local.get $5
       local.get $18
       i64.gt_s
       select
       i64.const 800
       i64.mul
       i64.const 1000
       i64.div_s
       local.tee $5
       i64.const 0
       i64.lt_s
       br_if $__inlined_func$assembly/power-anomaly/clampPermille$17
       drop
       i32.const 1000
       local.get $5
       i64.const 1000
       i64.gt_s
       br_if $__inlined_func$assembly/power-anomaly/clampPermille$17
       drop
       local.get $5
       i32.wrap_i64
      end
      local.tee $4
      i32.const 300
      i32.lt_s
      select
      local.set $7
      i32.const 400
      local.set $2
      local.get $0
      i32.load offset=24
      local.set $8
      local.get $0
      i32.load offset=28
     else
      local.get $21
     end
    else
     block $__inlined_func$assembly/power-anomaly/clampPermille$18 (result i32)
      i32.const 0
      local.get $20
      i64.const 350
      i64.mul
      local.get $23
      i64.const 350
      i64.mul
      i64.add
      local.get $18
      i64.const 150
      i64.mul
      i64.add
      local.get $5
      i64.const 100
      i64.mul
      i64.add
      local.get $19
      i64.const 50
      i64.mul
      i64.add
      i64.const 1000
      i64.div_s
      local.tee $5
      i64.const 0
      i64.lt_s
      br_if $__inlined_func$assembly/power-anomaly/clampPermille$18
      drop
      i32.const 1000
      local.get $5
      i64.const 1000
      i64.gt_s
      br_if $__inlined_func$assembly/power-anomaly/clampPermille$18
      drop
      local.get $5
      i32.wrap_i64
     end
     local.set $4
     i32.const 168
     i32.const 336
     local.get $21
     i32.const 1440
     i32.le_s
     select
     local.set $8
     i32.const 0
     local.set $2
     i32.const 0
     local.set $7
     loop $for-loop|3
      local.get $7
      i32.const 168
      i32.add
      local.tee $10
      local.get $21
      i32.le_s
      if
       local.get $22
       local.get $7
       local.get $10
       local.get $14
       local.get $2
       i32.const 24
       i32.mul
       i32.add
       call $assembly/power-anomaly/windowVector
       local.get $2
       i32.const 1
       i32.add
       local.set $2
       local.get $7
       local.get $8
       i32.add
       local.set $7
       br $for-loop|3
      end
     end
     local.get $22
     i32.const 0
     local.get $21
     local.get $13
     call $assembly/power-anomaly/windowVector
     local.get $4
     i32.const 120
     i32.ge_s
     local.tee $7
     local.get $13
     local.get $14
     local.get $2
     local.get $17
     i32.const 12
     i32.const 24
     local.get $21
     i32.const 1440
     i32.gt_s
     select
     local.get $16
     local.get $6
     i32.const 2
     i32.shl
     i32.add
     i32.load
     call $assembly/power-anomaly/isolationScore
     local.tee $2
     local.get $4
     i32.gt_s
     i32.and
     local.set $10
     local.get $7
     if
      block $__inlined_func$assembly/power-anomaly/clampPermille$19 (result i32)
       i32.const 0
       local.get $4
       i64.extend_i32_s
       i64.const 650
       i64.mul
       local.get $2
       i64.extend_i32_s
       i64.const 350
       i64.mul
       i64.add
       i64.const 1000
       i64.div_s
       local.tee $5
       i64.const 0
       i64.lt_s
       br_if $__inlined_func$assembly/power-anomaly/clampPermille$19
       drop
       i32.const 1000
       local.get $5
       i64.const 1000
       i64.gt_s
       br_if $__inlined_func$assembly/power-anomaly/clampPermille$19
       drop
       local.get $5
       i32.wrap_i64
      end
      local.set $4
     end
     local.get $15
     i32.const 0
     local.get $4
     i32.const 50
     i32.ge_s
     select
     local.set $7
     block $__inlined_func$assembly/power-anomaly/clampPermille$20 (result i32)
      i32.const 0
      local.get $4
      i32.const 500
      i32.sub
      i32.const 500
      local.get $4
      i32.sub
      local.get $4
      i32.const 500
      i32.gt_s
      select
      i64.extend_i32_s
      i64.const 500
      i64.add
      local.tee $5
      i64.const 0
      i64.lt_s
      br_if $__inlined_func$assembly/power-anomaly/clampPermille$20
      drop
      i32.const 1000
      local.get $5
      i64.const 1000
      i64.gt_s
      br_if $__inlined_func$assembly/power-anomaly/clampPermille$20
      drop
      local.get $5
      i32.wrap_i64
     end
     local.set $2
     local.get $0
     i32.load offset=24
     local.set $8
     local.get $0
     i32.load offset=28
    end
    local.set $15
    local.get $3
    local.get $6
    i32.const 24
    i32.mul
    i32.add
    local.tee $21
    local.get $4
    i32.store
    local.get $21
    local.get $7
    i32.store offset=4
    local.get $21
    local.get $10
    i32.store offset=8
    local.get $21
    local.get $2
    i32.store offset=12
    local.get $21
    local.get $8
    i32.store offset=16
    local.get $21
    local.get $15
    i32.store offset=20
    local.get $6
    i32.const 1
    i32.add
    local.set $6
    br $for-loop|1
   end
  end
  i32.const 0
 )
)

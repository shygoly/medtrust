(module
 (type $0 (func (param i32 i32 i32 i32) (result i32)))
 (import "env" "memory" (memory $0 1 1024))
 (global $assembly/power-features/abi_version i32 (i32.const 1))
 (export "abi_version" (global $assembly/power-features/abi_version))
 (export "run" (func $assembly/power-features/run))
 (export "memory" (memory $0))
 (func $assembly/power-features/run (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (result i32)
  (local $4 i32)
  (local $5 i32)
  (local $6 i64)
  (local $7 i32)
  (local $8 i64)
  (local $9 i32)
  (local $10 i64)
  (local $11 i32)
  (local $12 i64)
  (local $13 i32)
  (local $14 i64)
  (local $15 i32)
  (local $16 i32)
  (local $17 i64)
  (local $18 i32)
  (local $19 i64)
  (local $20 i32)
  (local $21 i32)
  (local $22 i64)
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
  if (result i32)
   local.get $2
   i32.const 2
   i32.lt_s
   local.get $2
   i32.const 168
   i32.gt_s
   i32.or
  else
   i32.const 0
  end
  if
   i32.const 2
   return
  end
  local.get $0
  i32.load
  local.tee $5
  if
   i32.const 5
   return
  end
  local.get $0
  local.get $1
  i32.const 1
  i32.add
  i32.const 2
  i32.shl
  i32.add
  local.set $13
  loop $for-loop|0
   local.get $1
   local.get $21
   i32.gt_s
   if
    local.get $0
    local.get $21
    i32.const 1
    i32.add
    i32.const 2
    i32.shl
    i32.add
    i32.load
    local.tee $4
    local.get $5
    i32.lt_u
    if
     i32.const 5
     return
    end
    local.get $4
    local.get $5
    i32.sub
    local.tee $5
    i32.const 3
    i32.lt_s
    local.get $5
    i32.const 65536
    i32.gt_s
    i32.or
    if
     i32.const 3
     return
    end
    local.get $4
    local.set $5
    local.get $21
    i32.const 1
    i32.add
    local.set $21
    br $for-loop|0
   end
  end
  local.get $13
  local.get $5
  i32.const 2
  i32.shl
  i32.add
  local.get $3
  i32.gt_s
  if
   i32.const 6
   return
  end
  local.get $2
  i32.const 7
  i32.add
  local.set $11
  loop $for-loop|1
   local.get $1
   local.get $16
   i32.gt_s
   if
    local.get $0
    local.get $16
    i32.const 1
    i32.add
    i32.const 2
    i32.shl
    i32.add
    i32.load
    local.get $0
    local.get $16
    i32.const 2
    i32.shl
    i32.add
    i32.load
    local.tee $4
    i32.sub
    local.set $20
    i64.const 0
    local.set $8
    local.get $13
    local.get $4
    i32.const 2
    i32.shl
    i32.add
    local.tee $15
    i32.load
    local.tee $21
    local.set $5
    i32.const 0
    local.set $7
    loop $for-loop|2
     local.get $7
     local.get $20
     i32.lt_s
     if
      local.get $15
      local.get $7
      i32.const 2
      i32.shl
      i32.add
      i32.load
      local.tee $4
      i32.const -5000000
      i32.lt_s
      local.get $4
      i32.const 5000000
      i32.gt_s
      i32.or
      if
       i32.const 4
       return
      end
      local.get $8
      local.get $4
      i64.extend_i32_s
      i64.add
      local.set $8
      local.get $4
      local.get $21
      local.get $4
      local.get $21
      i32.gt_s
      select
      local.set $21
      local.get $4
      local.get $5
      local.get $4
      local.get $5
      i32.lt_s
      select
      local.set $5
      local.get $7
      i32.const 1
      i32.add
      local.set $7
      br $for-loop|2
     end
    end
    local.get $8
    local.get $20
    i64.extend_i32_s
    i64.div_s
    local.set $12
    i64.const 0
    local.set $22
    i64.const 0
    local.set $6
    i32.const 0
    local.set $9
    loop $for-loop|3
     local.get $9
     local.get $20
     i32.lt_s
     if
      local.get $22
      local.get $15
      local.get $9
      i32.const 2
      i32.shl
      i32.add
      i64.load32_s
      local.tee $10
      local.get $12
      i64.sub
      local.tee $8
      local.get $8
      i64.mul
      i64.add
      local.set $22
      local.get $6
      local.get $9
      i64.extend_i32_s
      i64.const 1
      i64.shl
      local.get $20
      i32.const 1
      i32.sub
      i64.extend_i32_s
      i64.sub
      local.get $10
      i64.mul
      i64.add
      local.set $6
      local.get $9
      i32.const 1
      i32.add
      local.set $9
      br $for-loop|3
     end
    end
    local.get $22
    local.get $20
    i64.extend_i32_s
    i64.div_s
    local.tee $8
    i64.const 0
    i64.le_s
    if
     i64.const 0
     local.set $19
    else
     i64.const 0
     local.set $19
     i64.const 4611686018427387904
     local.set $22
     loop $while-continue|0
      local.get $8
      local.get $22
      i64.lt_s
      if
       local.get $22
       i64.const 2
       i64.shr_s
       local.set $22
       br $while-continue|0
      end
     end
     loop $while-continue|1
      local.get $22
      i64.const 0
      i64.ne
      if
       local.get $19
       local.get $22
       i64.add
       local.tee $10
       local.get $8
       i64.le_s
       if (result i64)
        local.get $8
        local.get $10
        i64.sub
        local.set $8
        local.get $19
        i64.const 1
        i64.shr_s
        local.get $22
        i64.add
       else
        local.get $19
        i64.const 1
        i64.shr_s
       end
       local.set $19
       local.get $22
       i64.const 2
       i64.shr_s
       local.set $22
       br $while-continue|1
      end
     end
    end
    local.get $6
    i64.const 1
    i64.shl
    local.tee $10
    local.get $20
    i64.extend_i32_s
    local.tee $6
    local.get $6
    local.get $6
    i64.mul
    i64.const 1
    i64.sub
    i64.mul
    i64.const 3
    i64.div_s
    local.tee $8
    i64.div_s
    local.tee $6
    i64.const 1000
    i64.mul
    local.get $10
    local.get $6
    local.get $8
    i64.mul
    i64.sub
    i64.const 1000
    i64.mul
    local.get $8
    i64.div_s
    i64.add
    local.set $14
    local.get $3
    local.get $11
    local.get $16
    i32.mul
    i32.const 2
    i32.shl
    i32.add
    local.set $18
    i64.const 0
    local.set $6
    i64.const 0
    local.set $22
    i32.const 0
    local.set $4
    i32.const 0
    local.set $7
    loop $for-loop|4
     local.get $2
     local.get $7
     i32.gt_s
     if
      i64.const 0
      local.set $10
      i64.const 0
      local.set $17
      local.get $7
      local.set $9
      loop $for-loop|5
       local.get $9
       local.get $20
       i32.lt_s
       if
        local.get $10
        local.get $15
        local.get $9
        i32.const 2
        i32.shl
        i32.add
        i64.load32_s
        i64.add
        local.set $10
        local.get $17
        i64.const 1
        i64.add
        local.set $17
        local.get $2
        local.get $9
        i32.add
        local.set $9
        br $for-loop|5
       end
      end
      i64.const 0
      local.set $8
      local.get $17
      i64.const 0
      i64.gt_s
      if
       local.get $4
       i32.eqz
       local.get $6
       local.get $10
       local.get $17
       i64.div_s
       local.tee $8
       i64.lt_s
       i32.or
       if
        local.get $8
        local.set $6
       end
       local.get $8
       local.get $22
       local.get $4
       i32.eqz
       local.get $8
       local.get $22
       i64.lt_s
       i32.or
       select
       local.set $22
       i32.const 1
       local.set $4
      end
      local.get $18
      local.get $7
      i32.const 7
      i32.add
      i32.const 2
      i32.shl
      i32.add
      local.get $8
      i64.store32
      local.get $7
      i32.const 1
      i32.add
      local.set $7
      br $for-loop|4
     end
    end
    local.get $18
    local.get $20
    i32.store
    local.get $18
    local.get $12
    i64.store32 offset=4
    local.get $18
    local.get $19
    i64.store32 offset=8
    local.get $18
    local.get $21
    i32.store offset=12
    local.get $18
    local.get $5
    i32.store offset=16
    local.get $18
    block $__inlined_func$assembly/power-features/clampI32$1 (result i32)
     i32.const 2147483647
     local.get $14
     i64.const 2147483647
     i64.gt_s
     br_if $__inlined_func$assembly/power-features/clampI32$1
     drop
     i32.const -2147483647
     local.get $14
     i64.const -2147483647
     i64.lt_s
     br_if $__inlined_func$assembly/power-features/clampI32$1
     drop
     local.get $14
     i32.wrap_i64
    end
    i32.store offset=20
    local.get $18
    local.get $6
    local.get $22
    i64.sub
    i32.wrap_i64
    i32.const 0
    local.get $4
    select
    i32.store offset=24
    local.get $16
    i32.const 1
    i32.add
    local.set $16
    br $for-loop|1
   end
  end
  i32.const 0
 )
)

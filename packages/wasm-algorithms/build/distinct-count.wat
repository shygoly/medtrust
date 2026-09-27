(module
 (type $0 (func (param i32 i32)))
 (type $1 (func (param i32 i32 i32 i32) (result i32)))
 (import "env" "memory" (memory $0 1 1024))
 (global $assembly/distinct-count/abi_version i32 (i32.const 1))
 (export "abi_version" (global $assembly/distinct-count/abi_version))
 (export "run" (func $assembly/distinct-count/run))
 (export "memory" (memory $0))
 (func $assembly/distinct-count/heapSort (param $0 i32) (param $1 i32)
  (local $2 i32)
  (local $3 i32)
  (local $4 i32)
  (local $5 i64)
  (local $6 i32)
  (local $7 i64)
  local.get $1
  i32.const 2
  i32.lt_s
  if
   return
  end
  local.get $1
  i32.const 1
  i32.shr_s
  i32.const 1
  i32.sub
  local.set $4
  loop $for-loop|0
   local.get $4
   i32.const 0
   i32.ge_s
   if
    local.get $4
    local.set $2
    loop $while-continue|0
     block $while-break|0
      local.get $2
      i32.const 1
      i32.shl
      i32.const 1
      i32.add
      local.tee $6
      local.get $1
      i32.ge_s
      br_if $while-break|0
      local.get $6
      i32.const 1
      i32.add
      local.tee $3
      local.get $1
      i32.lt_s
      if (result i32)
       local.get $0
       local.get $3
       i32.const 3
       i32.shl
       i32.add
       i64.load
       local.get $0
       local.get $6
       i32.const 3
       i32.shl
       i32.add
       i64.load
       i64.gt_u
      else
       i32.const 0
      end
      i32.eqz
      if
       local.get $6
       local.set $3
      end
      local.get $0
      local.get $3
      i32.const 3
      i32.shl
      i32.add
      local.tee $6
      i64.load
      local.tee $5
      local.get $0
      local.get $2
      i32.const 3
      i32.shl
      i32.add
      local.tee $2
      i64.load
      local.tee $7
      i64.le_u
      br_if $while-break|0
      local.get $2
      local.get $5
      i64.store
      local.get $6
      local.get $7
      i64.store
      local.get $3
      local.set $2
      br $while-continue|0
     end
    end
    local.get $4
    i32.const 1
    i32.sub
    local.set $4
    br $for-loop|0
   end
  end
  local.get $1
  i32.const 1
  i32.sub
  local.set $1
  loop $for-loop|1
   local.get $1
   i32.const 0
   i32.gt_s
   if
    local.get $0
    i64.load
    local.set $5
    local.get $0
    local.get $0
    local.get $1
    i32.const 3
    i32.shl
    i32.add
    local.tee $2
    i64.load
    i64.store
    local.get $2
    local.get $5
    i64.store
    local.get $1
    local.set $3
    i32.const 0
    local.set $2
    loop $while-continue|00
     block $while-break|01
      local.get $2
      i32.const 1
      i32.shl
      i32.const 1
      i32.add
      local.tee $4
      local.get $3
      i32.ge_s
      br_if $while-break|01
      local.get $4
      i32.const 1
      i32.add
      local.tee $1
      local.get $3
      i32.lt_s
      if (result i32)
       local.get $0
       local.get $1
       i32.const 3
       i32.shl
       i32.add
       i64.load
       local.get $0
       local.get $4
       i32.const 3
       i32.shl
       i32.add
       i64.load
       i64.gt_u
      else
       i32.const 0
      end
      i32.eqz
      if
       local.get $4
       local.set $1
      end
      local.get $0
      local.get $1
      i32.const 3
      i32.shl
      i32.add
      local.tee $4
      i64.load
      local.tee $5
      local.get $0
      local.get $2
      i32.const 3
      i32.shl
      i32.add
      local.tee $2
      i64.load
      local.tee $7
      i64.le_u
      br_if $while-break|01
      local.get $2
      local.get $5
      i64.store
      local.get $4
      local.get $7
      i64.store
      local.get $1
      local.set $2
      br $while-continue|00
     end
    end
    local.get $3
    i32.const 1
    i32.sub
    local.set $1
    br $for-loop|1
   end
  end
 )
 (func $assembly/distinct-count/run (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (result i32)
  (local $4 i64)
  (local $5 i32)
  (local $6 i64)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  local.get $0
  local.get $3
  i32.or
  local.get $1
  i32.or
  local.get $2
  i32.or
  i32.const 0
  i32.lt_s
  if
   i32.const 1
   return
  end
  local.get $1
  i32.const 1048576
  i32.gt_s
  local.get $2
  i32.const 64
  i32.gt_s
  i32.or
  if
   i32.const 2
   return
  end
  local.get $0
  local.tee $5
  local.get $1
  i32.const 2
  i32.shl
  i32.add
  local.tee $10
  local.get $1
  i32.add
  i32.const 7
  i32.add
  i32.const -8
  i32.and
  local.tee $8
  local.get $1
  i32.const 3
  i32.shl
  i32.add
  local.get $3
  i32.gt_s
  local.get $1
  i32.const 0
  i32.gt_s
  i32.and
  if
   i32.const 2
   return
  end
  i32.const 0
  local.set $0
  loop $for-loop|0
   local.get $0
   local.get $2
   i32.lt_s
   if
    local.get $3
    i32.const 4
    i32.add
    local.get $0
    i32.const 2
    i32.shl
    i32.add
    i32.const 0
    i32.store
    local.get $0
    i32.const 1
    i32.add
    local.set $0
    br $for-loop|0
   end
  end
  local.get $1
  i32.eqz
  if
   local.get $3
   i32.const 0
   i32.store
   i32.const 0
   return
  end
  i32.const 0
  local.set $0
  loop $for-loop|1
   local.get $0
   local.get $1
   i32.lt_s
   if
    local.get $0
    local.get $10
    i32.add
    i32.load8_u
    local.tee $7
    local.get $2
    i32.ge_s
    if
     i32.const 3
     return
    end
    local.get $8
    local.get $0
    i32.const 3
    i32.shl
    i32.add
    local.get $5
    local.get $0
    i32.const 2
    i32.shl
    i32.add
    i64.load32_u
    local.get $7
    i64.extend_i32_s
    i64.const 32
    i64.shl
    i64.or
    i64.store
    local.get $0
    i32.const 1
    i32.add
    local.set $0
    br $for-loop|1
   end
  end
  local.get $8
  local.get $1
  call $assembly/distinct-count/heapSort
  i32.const -1
  local.set $0
  i32.const 0
  local.set $2
  loop $for-loop|2
   local.get $1
   local.get $2
   i32.gt_s
   if
    local.get $9
    i32.eqz
    local.get $0
    local.get $8
    local.get $2
    i32.const 3
    i32.shl
    i32.add
    i64.load
    local.tee $4
    i64.const 32
    i64.shr_u
    i32.wrap_i64
    local.tee $0
    i32.ne
    i32.or
    local.get $6
    local.get $4
    i64.const 4294967295
    i64.and
    local.tee $6
    i64.ne
    i32.or
    if
     local.get $3
     i32.const 4
     i32.add
     local.get $0
     i32.const 2
     i32.shl
     i32.add
     local.tee $7
     local.get $7
     i32.load
     i32.const 1
     i32.add
     i32.store
    end
    i32.const 1
    local.set $9
    local.get $2
    i32.const 1
    i32.add
    local.set $2
    br $for-loop|2
   end
  end
  i32.const 0
  local.set $0
  loop $for-loop|3
   local.get $0
   local.get $1
   i32.lt_s
   if
    local.get $8
    local.get $0
    i32.const 3
    i32.shl
    i32.add
    local.get $5
    local.get $0
    i32.const 2
    i32.shl
    i32.add
    i64.load32_u
    i64.store
    local.get $0
    i32.const 1
    i32.add
    local.set $0
    br $for-loop|3
   end
  end
  local.get $8
  local.get $1
  call $assembly/distinct-count/heapSort
  i32.const 1
  local.set $2
  local.get $8
  i64.load
  local.set $6
  i32.const 1
  local.set $0
  loop $for-loop|4
   local.get $0
   local.get $1
   i32.lt_s
   if
    local.get $8
    local.get $0
    i32.const 3
    i32.shl
    i32.add
    i64.load
    local.tee $4
    local.get $6
    i64.ne
    if
     local.get $4
     local.set $6
     local.get $2
     i32.const 1
     i32.add
     local.set $2
    end
    local.get $0
    i32.const 1
    i32.add
    local.set $0
    br $for-loop|4
   end
  end
  local.get $3
  local.get $2
  i32.store
  i32.const 0
 )
)

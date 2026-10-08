(module
 (type $0 (func (param i32 i32 i32 i32) (result i32)))
 (import "env" "memory" (memory $0 1 1024))
 (global $assembly/external-control/abi_version i32 (i32.const 1))
 (export "abi_version" (global $assembly/external-control/abi_version))
 (export "run" (func $assembly/external-control/run))
 (export "memory" (memory $0))
 (func $assembly/external-control/run (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (result i32)
  (local $4 i32)
  (local $5 i32)
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
  local.get $0
  i32.const 0
  i32.lt_s
  local.get $0
  local.get $3
  i32.ge_s
  i32.or
  local.get $2
  i32.const 0
  i32.le_s
  i32.or
  local.get $1
  i32.const 0
  i32.lt_s
  i32.or
  if
   i32.const 5
   return
  end
  local.get $0
  i32.load
  local.tee $4
  local.get $0
  i32.load offset=4
  local.tee $5
  i32.add
  local.get $1
  i32.ne
  local.get $4
  local.get $5
  i32.or
  i32.const 0
  i32.lt_s
  i32.or
  local.get $0
  i32.load offset=8
  local.tee $11
  i32.const 0
  i32.lt_s
  i32.or
  local.get $0
  i32.load offset=12
  local.tee $14
  i32.const 0
  i32.le_s
  i32.or
  if
   i32.const 5
   return
  end
  local.get $0
  i32.const 16
  i32.add
  local.tee $9
  local.get $4
  i32.const 2
  i32.shl
  i32.add
  local.tee $12
  local.get $4
  i32.add
  local.tee $10
  local.get $4
  i32.add
  local.tee $7
  local.get $5
  i32.const 2
  i32.shl
  i32.add
  local.tee $13
  local.get $5
  i32.add
  local.set $8
  i32.const 1
  local.set $0
  loop $for-loop|0
   local.get $0
   local.get $4
   i32.lt_s
   if
    local.get $0
    local.get $10
    i32.add
    local.tee $1
    i32.const 1
    i32.sub
    i32.load8_u
    local.tee $6
    local.get $1
    i32.load8_u
    local.tee $1
    i32.gt_s
    if (result i32)
     i32.const 1
    else
     local.get $1
     local.get $6
     i32.eq
     if (result i32)
      local.get $9
      local.get $0
      i32.const 1
      i32.sub
      i32.const 2
      i32.shl
      i32.add
      i32.load
      local.get $9
      local.get $0
      i32.const 2
      i32.shl
      i32.add
      i32.load
      i32.gt_s
     else
      i32.const 0
     end
    end
    if
     i32.const 6
     return
    end
    local.get $0
    i32.const 1
    i32.add
    local.set $0
    br $for-loop|0
   end
  end
  i32.const 1
  local.set $0
  loop $for-loop|1
   local.get $0
   local.get $5
   i32.lt_s
   if
    local.get $0
    local.get $8
    i32.add
    local.tee $1
    i32.const 1
    i32.sub
    i32.load8_u
    local.tee $6
    local.get $1
    i32.load8_u
    local.tee $1
    i32.gt_s
    if (result i32)
     i32.const 1
    else
     local.get $1
     local.get $6
     i32.eq
     if (result i32)
      local.get $7
      local.get $0
      i32.const 1
      i32.sub
      i32.const 2
      i32.shl
      i32.add
      i32.load
      local.get $7
      local.get $0
      i32.const 2
      i32.shl
      i32.add
      i32.load
      i32.gt_s
     else
      i32.const 0
     end
    end
    if
     i32.const 6
     return
    end
    local.get $0
    i32.const 1
    i32.add
    local.set $0
    br $for-loop|1
   end
  end
  i32.const 0
  local.set $0
  loop $for-loop|2
   local.get $0
   local.get $4
   i32.lt_s
   if
    local.get $0
    local.get $10
    i32.add
    i32.load8_u
    local.get $2
    i32.ge_s
    if
     i32.const 3
     return
    end
    local.get $0
    i32.const 1
    i32.add
    local.set $0
    br $for-loop|2
   end
  end
  i32.const 0
  local.set $0
  loop $for-loop|3
   local.get $0
   local.get $5
   i32.lt_s
   if
    local.get $0
    local.get $8
    i32.add
    i32.load8_u
    local.get $2
    i32.ge_s
    if
     i32.const 3
     return
    end
    local.get $0
    i32.const 1
    i32.add
    local.set $0
    br $for-loop|3
   end
  end
  i32.const 0
  local.set $0
  loop $for-loop|4
   local.get $0
   local.get $4
   i32.lt_s
   if
    local.get $0
    local.get $12
    i32.add
    i32.load8_u
    local.tee $1
    i32.const 1
    i32.ne
    i32.const 0
    local.get $1
    select
    if
     i32.const 5
     return
    end
    local.get $0
    i32.const 1
    i32.add
    local.set $0
    br $for-loop|4
   end
  end
  i32.const 0
  local.set $0
  loop $for-loop|5
   local.get $0
   local.get $5
   i32.lt_s
   if
    local.get $0
    local.get $13
    i32.add
    i32.load8_u
    local.tee $1
    i32.const 1
    i32.ne
    i32.const 0
    local.get $1
    select
    if
     i32.const 5
     return
    end
    local.get $0
    i32.const 1
    i32.add
    local.set $0
    br $for-loop|5
   end
  end
  i32.const 0
  local.set $0
  loop $for-loop|6
   local.get $0
   local.get $2
   i32.lt_s
   if
    i32.const 0
    local.set $1
    loop $for-loop|7
     local.get $1
     i32.const 6
     i32.lt_s
     if
      local.get $3
      local.get $0
      i32.const 24
      i32.mul
      i32.add
      local.get $1
      i32.const 2
      i32.shl
      i32.add
      i32.const 0
      i32.store
      local.get $1
      i32.const 1
      i32.add
      local.set $1
      br $for-loop|7
     end
    end
    local.get $0
    i32.const 1
    i32.add
    local.set $0
    br $for-loop|6
   end
  end
  i32.const 0
  local.set $0
  i32.const 0
  local.set $2
  loop $for-loop|8
   local.get $2
   local.get $4
   i32.lt_s
   if
    local.get $2
    local.get $10
    i32.add
    i32.load8_u
    local.set $16
    local.get $9
    local.get $2
    i32.const 2
    i32.shl
    i32.add
    i32.load
    local.tee $17
    local.get $11
    i32.sub
    local.set $1
    loop $while-continue|9
     local.get $0
     local.get $5
     i32.lt_s
     if
      local.get $0
      local.get $8
      i32.add
      i32.load8_u
      local.tee $6
      local.get $16
      i32.lt_s
      if
       local.get $0
       i32.const 1
       i32.add
       local.set $0
       br $while-continue|9
      end
      local.get $6
      local.get $16
      i32.eq
      if (result i32)
       local.get $7
       local.get $0
       i32.const 2
       i32.shl
       i32.add
       i32.load
       local.get $1
       i32.lt_s
      else
       i32.const 0
      end
      if
       local.get $0
       i32.const 1
       i32.add
       local.set $0
       br $while-continue|9
      end
     end
    end
    i32.const 0
    local.set $6
    local.get $0
    local.set $1
    loop $while-continue|10
     local.get $1
     local.get $5
     i32.lt_s
     local.get $6
     local.get $14
     i32.lt_s
     i32.and
     if
      block $while-break|10
       local.get $1
       local.get $8
       i32.add
       i32.load8_u
       local.get $16
       i32.ne
       br_if $while-break|10
       local.get $7
       local.get $1
       i32.const 2
       i32.shl
       i32.add
       i32.load
       local.get $11
       local.get $17
       i32.add
       i32.gt_s
       br_if $while-break|10
       local.get $3
       local.get $16
       i32.const 24
       i32.mul
       i32.add
       i32.const 8
       i32.const 12
       local.get $1
       local.get $13
       i32.add
       i32.load8_u
       i32.const 1
       i32.eq
       select
       i32.add
       local.tee $15
       local.get $15
       i32.load
       i32.const 1
       i32.add
       i32.store
       local.get $6
       i32.const 1
       i32.add
       local.set $6
       local.get $1
       i32.const 1
       i32.add
       local.set $1
       br $while-continue|10
      end
     end
    end
    local.get $3
    local.get $16
    i32.const 24
    i32.mul
    i32.add
    local.set $15
    local.get $6
    i32.const 0
    i32.gt_s
    if
     local.get $15
     local.get $15
     i32.load offset=16
     i32.const 1
     i32.add
     i32.store offset=16
     local.get $15
     local.get $2
     local.get $12
     i32.add
     i32.load8_u
     i32.const 1
     i32.ne
     i32.const 2
     i32.shl
     i32.add
     local.tee $0
     local.get $0
     i32.load
     i32.const 1
     i32.add
     i32.store
     local.get $1
     local.set $0
    else
     local.get $15
     local.get $15
     i32.load offset=20
     i32.const 1
     i32.add
     i32.store offset=20
    end
    local.get $2
    i32.const 1
    i32.add
    local.set $2
    br $for-loop|8
   end
  end
  i32.const 0
 )
)

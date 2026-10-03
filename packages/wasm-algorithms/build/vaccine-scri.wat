(module
 (type $0 (func (param i32 i32 i32 i32) (result i32)))
 (import "env" "memory" (memory $0 1 1024))
 (global $assembly/scri/abi_version i32 (i32.const 1))
 (export "abi_version" (global $assembly/scri/abi_version))
 (export "run" (func $assembly/scri/run))
 (export "memory" (memory $0))
 (func $assembly/scri/run (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (result i32)
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
  local.get $2
  i32.const 64
  i32.gt_s
  if
   i32.const 2
   return
  end
  local.get $0
  i32.load offset=8
  local.tee $4
  local.get $0
  i32.load offset=12
  local.tee $5
  i32.gt_s
  local.get $0
  i32.load
  local.tee $6
  local.get $0
  i32.load offset=4
  local.tee $7
  i32.gt_s
  i32.or
  local.get $0
  i32.load offset=16
  local.tee $8
  i32.const 0
  i32.lt_s
  i32.or
  if
   i32.const 4
   return
  end
  local.get $5
  local.get $6
  i32.lt_s
  local.get $4
  local.get $7
  i32.gt_s
  i32.or
  i32.eqz
  if
   i32.const 5
   return
  end
  local.get $0
  i32.const 20
  i32.add
  local.tee $9
  local.get $1
  i32.const 2
  i32.shl
  i32.add
  local.tee $10
  local.get $1
  i32.add
  local.set $11
  i32.const 0
  local.set $0
  loop $for-loop|0
   local.get $0
   local.get $2
   i32.lt_s
   if
    local.get $3
    local.get $0
    i32.const 12
    i32.mul
    i32.add
    local.tee $12
    i32.const 0
    i32.store
    local.get $12
    i32.const 0
    i32.store offset=4
    local.get $12
    i32.const 0
    i32.store offset=8
    local.get $0
    i32.const 1
    i32.add
    local.set $0
    br $for-loop|0
   end
  end
  i32.const 0
  local.set $0
  loop $for-loop|1
   local.get $0
   local.get $1
   i32.lt_s
   if
    local.get $9
    local.get $0
    i32.const 2
    i32.shl
    i32.add
    i32.load
    local.set $12
    local.get $0
    local.get $10
    i32.add
    i32.load8_u
    local.tee $13
    local.get $2
    i32.ge_s
    if
     i32.const 3
     return
    end
    local.get $3
    local.get $13
    i32.const 12
    i32.mul
    i32.add
    local.set $13
    local.get $6
    local.get $12
    i32.le_s
    local.get $7
    local.get $12
    i32.ge_s
    i32.and
    if
     local.get $13
     local.get $13
     i32.load
     i32.const 1
     i32.add
     i32.store
    else
     local.get $4
     local.get $12
     i32.le_s
     local.get $5
     local.get $12
     i32.ge_s
     i32.and
     if
      local.get $13
      local.get $13
      i32.load offset=4
      i32.const 1
      i32.add
      i32.store offset=4
     end
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
   local.get $8
   i32.lt_s
   if
    local.get $0
    local.get $11
    i32.add
    i32.load8_u
    local.tee $1
    local.get $2
    i32.ge_s
    if
     i32.const 3
     return
    end
    local.get $3
    local.get $1
    i32.const 12
    i32.mul
    i32.add
    local.tee $1
    i32.const 8
    i32.add
    local.get $1
    i32.load offset=8
    i32.const 1
    i32.add
    i32.store
    local.get $0
    i32.const 1
    i32.add
    local.set $0
    br $for-loop|2
   end
  end
  i32.const 0
 )
)

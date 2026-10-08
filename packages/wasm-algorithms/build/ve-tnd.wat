(module
 (type $0 (func (param i32 i32 i32 i32) (result i32)))
 (import "env" "memory" (memory $0 1 1024))
 (global $assembly/ve-tnd/abi_version i32 (i32.const 1))
 (export "abi_version" (global $assembly/ve-tnd/abi_version))
 (export "run" (func $assembly/ve-tnd/run))
 (export "memory" (memory $0))
 (func $assembly/ve-tnd/run (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (result i32)
  (local $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  local.get $0
  i32.const 0
  i32.lt_s
  local.get $0
  local.get $3
  i32.ge_s
  i32.or
  local.get $1
  i32.const 0
  i32.lt_s
  i32.or
  local.get $2
  i32.const 0
  i32.le_s
  i32.or
  if
   i32.const 5
   return
  end
  local.get $0
  i32.load
  local.tee $5
  i32.const 0
  i32.le_s
  if
   i32.const 5
   return
  end
  local.get $0
  i32.const 4
  i32.add
  local.tee $6
  local.get $1
  i32.const 2
  i32.shl
  i32.add
  local.tee $7
  local.get $1
  i32.add
  local.set $8
  i32.const 0
  local.set $0
  loop $for-loop|0
   local.get $0
   local.get $2
   i32.lt_s
   if
    i32.const 0
    local.set $4
    loop $for-loop|1
     local.get $4
     i32.const 6
     i32.lt_s
     if
      local.get $3
      local.get $0
      i32.const 24
      i32.mul
      i32.add
      local.get $4
      i32.const 2
      i32.shl
      i32.add
      i32.const 0
      i32.store
      local.get $4
      i32.const 1
      i32.add
      local.set $4
      br $for-loop|1
     end
    end
    local.get $0
    i32.const 1
    i32.add
    local.set $0
    br $for-loop|0
   end
  end
  i32.const 0
  local.set $0
  loop $for-loop|2
   local.get $0
   local.get $1
   i32.lt_s
   if
    local.get $0
    local.get $8
    i32.add
    i32.load8_u
    local.tee $9
    local.get $2
    i32.ge_s
    if
     i32.const 3
     return
    end
    local.get $0
    local.get $7
    i32.add
    i32.load8_u
    local.tee $4
    i32.const 1
    i32.ne
    i32.const 0
    local.get $4
    select
    if
     i32.const 5
     return
    end
    local.get $3
    local.get $9
    i32.const 24
    i32.mul
    i32.add
    local.get $6
    local.get $0
    i32.const 2
    i32.shl
    i32.add
    i32.load
    local.tee $9
    i32.const -2147483648
    i32.eq
    local.get $9
    i32.const 0
    i32.lt_s
    i32.or
    if (result i32)
     i32.const 2
     i32.const 3
     local.get $4
     i32.const 1
     i32.eq
     select
    else
     local.get $5
     local.get $9
     i32.le_s
     if (result i32)
      local.get $4
      i32.const 1
      i32.ne
     else
      i32.const 4
      i32.const 5
      local.get $4
      i32.const 1
      i32.eq
      select
     end
    end
    i32.const 2
    i32.shl
    i32.add
    local.tee $4
    local.get $4
    i32.load
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

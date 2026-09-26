(module
 (type $0 (func (param i32 i32 i32 i32 i32) (result i32)))
 (import "env" "memory" (memory $0 1 1024))
 (global $assembly/pairing/abi_version i32 (i32.const 1))
 (export "abi_version" (global $assembly/pairing/abi_version))
 (export "run" (func $assembly/pairing/run))
 (export "memory" (memory $0))
 (func $assembly/pairing/run (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (param $4 i32) (result i32)
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
  local.get $0
  local.get $4
  i32.or
  i32.const 0
  i32.lt_s
  local.get $1
  i32.const 0
  i32.le_s
  i32.or
  local.get $2
  i32.const 0
  i32.lt_s
  i32.or
  local.get $3
  i32.const 0
  i32.lt_s
  i32.or
  if
   i32.const 1
   return
  end
  local.get $3
  i32.const 64
  i32.gt_s
  local.get $1
  i32.const 8
  i32.gt_s
  i32.or
  if
   i32.const 2
   return
  end
  local.get $0
  local.get $1
  local.get $2
  i32.mul
  i32.add
  local.tee $12
  local.get $2
  i32.add
  local.tee $13
  local.get $2
  i32.add
  local.set $14
  loop $for-loop|0
   local.get $3
   local.get $5
   i32.gt_s
   if
    local.get $4
    i32.const 16
    i32.add
    local.get $5
    i32.const 12
    i32.mul
    i32.add
    local.tee $6
    i32.const 0
    i32.store
    local.get $6
    i32.const 0
    i32.store offset=4
    local.get $6
    i32.const 0
    i32.store offset=8
    local.get $5
    i32.const 1
    i32.add
    local.set $5
    br $for-loop|0
   end
  end
  loop $for-loop|1
   local.get $2
   local.get $7
   i32.gt_s
   if
    i32.const 1
    local.set $6
    i32.const 0
    local.set $5
    loop $for-loop|2
     local.get $1
     local.get $5
     i32.gt_s
     if
      block $for-break2
       local.get $0
       local.get $1
       local.get $7
       i32.mul
       i32.add
       local.get $5
       i32.add
       i32.load8_u
       i32.eqz
       if
        i32.const 0
        local.set $6
        br $for-break2
       end
       local.get $5
       i32.const 1
       i32.add
       local.set $5
       br $for-loop|2
      end
     end
    end
    local.get $6
    if
     local.get $7
     local.get $12
     i32.add
     i32.load8_u
     i32.const 0
     i32.ne
     local.set $5
     local.get $7
     local.get $13
     i32.add
     i32.load8_u
     i32.const 0
     i32.ne
     local.set $6
     local.get $7
     local.get $14
     i32.add
     i32.load8_u
     local.tee $15
     local.get $3
     i32.ge_s
     if
      i32.const 3
      return
     end
     local.get $11
     i32.const 1
     i32.add
     local.set $11
     local.get $8
     i32.const 1
     i32.add
     local.get $8
     local.get $5
     select
     local.set $8
     local.get $9
     i32.const 1
     i32.add
     local.get $9
     local.get $6
     select
     local.set $9
     local.get $10
     i32.const 1
     i32.add
     local.get $10
     local.get $5
     local.get $6
     i32.and
     select
     local.set $10
     local.get $4
     i32.const 16
     i32.add
     local.get $15
     i32.const 12
     i32.mul
     i32.const 255
     i32.and
     i32.add
     local.set $15
     local.get $5
     if
      local.get $15
      local.get $15
      i32.load
      i32.const 1
      i32.add
      i32.store
     end
     local.get $5
     local.get $6
     i32.and
     if
      local.get $15
      i32.const 4
      i32.add
      local.get $15
      i32.load offset=4
      i32.const 1
      i32.add
      i32.store
     end
     local.get $15
     i32.const 8
     i32.add
     local.get $15
     i32.load offset=8
     i32.const 1
     i32.add
     i32.store
    end
    local.get $7
    i32.const 1
    i32.add
    local.set $7
    br $for-loop|1
   end
  end
  local.get $4
  local.get $11
  i32.store
  local.get $4
  local.get $8
  i32.store offset=4
  local.get $4
  local.get $9
  i32.store offset=8
  local.get $4
  local.get $10
  i32.store offset=12
  i32.const 0
 )
)

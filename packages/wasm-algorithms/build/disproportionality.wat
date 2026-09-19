(module
 (type $0 (func (param i32 i32 i32 i32) (result i32)))
 (import "env" "memory" (memory $0 1 1024))
 (global $assembly/disproportionality/abi_version i32 (i32.const 1))
 (export "abi_version" (global $assembly/disproportionality/abi_version))
 (export "run" (func $assembly/disproportionality/run))
 (export "memory" (memory $0))
 (func $assembly/disproportionality/run (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (result i32)
  (local $4 i32)
  (local $5 i32)
  (local $6 i32)
  (local $7 i32)
  (local $8 i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 i32)
  local.get $1
  local.get $2
  i32.or
  local.get $0
  i32.or
  local.get $3
  i32.or
  i32.const 0
  i32.lt_s
  if
   i32.const 1
   return
  end
  local.get $0
  local.get $1
  i32.add
  local.set $9
  local.get $0
  local.get $1
  i32.const 1
  i32.shl
  i32.add
  local.set $10
  loop $for-loop|0
   local.get $1
   local.get $5
   i32.gt_s
   if
    local.get $0
    local.get $5
    i32.add
    i32.load8_u
    if
     local.get $6
     i32.const 1
     i32.add
     local.get $6
     local.get $5
     local.get $9
     i32.add
     i32.load8_u
     select
     local.set $6
     local.get $4
     i32.const 1
     i32.add
     local.set $4
    end
    local.get $5
    i32.const 1
    i32.add
    local.set $5
    br $for-loop|0
   end
  end
  local.get $4
  local.get $6
  i32.sub
  local.set $11
  local.get $3
  local.get $4
  i32.store
  loop $for-loop|1
   local.get $2
   local.get $7
   i32.gt_s
   if
    i32.const 0
    local.set $4
    i32.const 0
    local.set $8
    i32.const 0
    local.set $5
    loop $for-loop|2
     local.get $1
     local.get $5
     i32.gt_s
     if
      block $for-continue|2
       local.get $0
       local.get $5
       i32.add
       i32.load8_u
       i32.eqz
       br_if $for-continue|2
       local.get $10
       local.get $2
       local.get $5
       i32.mul
       i32.add
       local.get $7
       i32.add
       i32.load8_u
       i32.eqz
       br_if $for-continue|2
       local.get $5
       local.get $9
       i32.add
       i32.load8_u
       if
        local.get $4
        i32.const 1
        i32.add
        local.set $4
       else
        local.get $8
        i32.const 1
        i32.add
        local.set $8
       end
      end
      local.get $5
      i32.const 1
      i32.add
      local.set $5
      br $for-loop|2
     end
    end
    local.get $3
    i32.const 4
    i32.add
    local.get $7
    i32.const 4
    i32.shl
    i32.add
    local.tee $5
    local.get $4
    i32.store
    local.get $5
    local.get $6
    local.get $4
    i32.sub
    i32.store offset=4
    local.get $5
    local.get $8
    i32.store offset=8
    local.get $5
    local.get $11
    local.get $8
    i32.sub
    i32.store offset=12
    local.get $7
    i32.const 1
    i32.add
    local.set $7
    br $for-loop|1
   end
  end
  i32.const 0
 )
)

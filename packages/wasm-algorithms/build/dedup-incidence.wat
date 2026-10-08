(module
 (type $0 (func (param i32 i32 i32 i32) (result i32)))
 (import "env" "memory" (memory $0 1 1024))
 (global $assembly/dedup-incidence/abi_version i32 (i32.const 1))
 (export "abi_version" (global $assembly/dedup-incidence/abi_version))
 (export "run" (func $assembly/dedup-incidence/run))
 (export "memory" (memory $0))
 (func $assembly/dedup-incidence/run (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32) (result i32)
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
  i32.load offset=12
  local.set $6
  local.get $0
  i32.load offset=8
  local.tee $14
  local.get $0
  i32.load offset=4
  local.tee $11
  local.get $0
  i32.load
  local.tee $25
  i32.or
  i32.or
  i32.const 0
  i32.lt_s
  if
   i32.const 5
   return
  end
  local.get $11
  local.get $25
  i32.add
  local.get $14
  i32.add
  local.get $1
  i32.ne
  if
   i32.const 5
   return
  end
  local.get $6
  i32.const 1
  i32.ne
  i32.const 0
  local.get $6
  select
  if
   i32.const 5
   return
  end
  local.get $0
  i32.const 16
  i32.add
  local.tee $15
  local.get $25
  i32.const 2
  i32.shl
  local.tee $0
  i32.add
  local.tee $18
  local.get $25
  i32.add
  i32.const 3
  i32.add
  i32.const -4
  i32.and
  local.set $16
  local.get $0
  local.get $16
  i32.add
  local.tee $19
  local.get $0
  i32.add
  local.tee $20
  local.get $11
  i32.const 2
  i32.shl
  local.tee $0
  i32.add
  local.tee $21
  local.get $11
  i32.add
  i32.const 3
  i32.add
  i32.const -4
  i32.and
  local.set $17
  local.get $0
  local.get $17
  i32.add
  local.tee $22
  local.get $14
  i32.const 2
  i32.shl
  i32.add
  local.set $23
  i32.const 0
  local.set $0
  loop $for-loop|0
   local.get $0
   local.get $2
   i32.lt_s
   if
    i32.const 0
    local.set $1
    loop $for-loop|1
     local.get $1
     i32.const 4
     i32.lt_s
     if
      local.get $3
      local.get $0
      i32.const 4
      i32.shl
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
  i32.const -1
  local.set $5
  i32.const 0
  local.set $0
  i32.const 2
  i32.const 1
  local.get $6
  i32.const 1
  i32.eq
  select
  local.set $24
  block $folding-inner0
   loop $for-loop|2
    local.get $12
    local.get $25
    i32.lt_s
    if
     local.get $12
     local.get $18
     i32.add
     i32.load8_u
     local.tee $6
     local.get $2
     i32.ge_s
     if
      i32.const 3
      return
     end
     local.get $15
     local.get $12
     i32.const 2
     i32.shl
     local.tee $26
     i32.add
     i32.load
     local.set $7
     local.get $16
     local.get $26
     i32.add
     i32.load
     local.tee $1
     local.get $19
     local.get $26
     i32.add
     i32.load
     local.tee $26
     i32.gt_s
     if
      i32.const 5
      return
     end
     local.get $13
     if
      local.get $5
      local.get $6
      i32.gt_s
      br_if $folding-inner0
      local.get $5
      local.get $6
      i32.eq
      local.tee $27
      local.get $7
      local.get $8
      i32.lt_u
      i32.and
      br_if $folding-inner0
      local.get $27
      local.get $7
      local.get $8
      i32.eq
      i32.and
      local.get $1
      local.get $4
      i32.lt_s
      i32.and
      br_if $folding-inner0
     end
     local.get $13
     i32.eqz
     local.get $5
     local.get $6
     i32.ne
     i32.or
     local.get $7
     local.get $8
     i32.ne
     i32.or
     if (result i32)
      local.get $13
      if
       local.get $3
       local.get $5
       i32.const 4
       i32.shl
       i32.add
       local.tee $5
       i32.const 4
       i32.add
       local.get $5
       i32.load offset=4
       local.get $0
       local.get $4
       i32.sub
       i32.const 1
       i32.add
       i32.add
       i32.store
      end
      local.get $3
      local.get $6
      i32.const 4
      i32.shl
      i32.add
      local.tee $0
      local.get $0
      i32.load
      i32.const 1
      i32.add
      i32.store
      local.get $6
      local.set $5
      local.get $7
      local.set $8
      local.get $1
      local.set $4
      i32.const 1
      local.set $13
      local.get $26
     else
      local.get $1
      local.get $0
      local.get $24
      i32.add
      i32.le_s
      if (result i32)
       local.get $26
       local.get $0
       local.get $0
       local.get $26
       i32.lt_s
       select
      else
       local.get $3
       local.get $5
       i32.const 4
       i32.shl
       i32.add
       local.tee $6
       i32.const 4
       i32.add
       local.get $6
       i32.load offset=4
       local.get $0
       local.get $4
       i32.sub
       i32.const 1
       i32.add
       i32.add
       i32.store
       local.get $1
       local.set $4
       local.get $26
      end
     end
     local.set $0
     local.get $12
     i32.const 1
     i32.add
     local.set $12
     br $for-loop|2
    end
   end
   local.get $13
   if
    local.get $3
    local.get $5
    i32.const 4
    i32.shl
    i32.add
    local.tee $1
    i32.const 4
    i32.add
    local.get $1
    i32.load offset=4
    local.get $0
    local.get $4
    i32.sub
    i32.const 1
    i32.add
    i32.add
    i32.store
   end
   i32.const -1
   local.set $1
   i32.const 0
   local.set $4
   i32.const 0
   local.set $5
   i32.const 0
   local.set $8
   loop $for-loop|3
    local.get $8
    local.get $11
    i32.lt_s
    if
     local.get $8
     local.get $21
     i32.add
     i32.load8_u
     local.tee $0
     local.get $2
     i32.ge_s
     if
      i32.const 3
      return
     end
     local.get $8
     i32.const 2
     i32.shl
     local.tee $7
     local.get $20
     i32.add
     i32.load
     local.set $6
     local.get $7
     local.get $17
     i32.add
     i32.load
     local.set $7
     local.get $10
     if
      local.get $0
      local.get $1
      i32.lt_s
      br_if $folding-inner0
      local.get $0
      local.get $1
      i32.eq
      local.tee $12
      local.get $4
      local.get $6
      i32.gt_u
      i32.and
      br_if $folding-inner0
      local.get $12
      local.get $4
      local.get $6
      i32.eq
      i32.and
      local.get $5
      local.get $7
      i32.gt_u
      i32.and
      br_if $folding-inner0
     end
     i32.const 1
     local.get $5
     local.get $7
     i32.ne
     local.get $10
     i32.eqz
     local.tee $5
     i32.eqz
     if
      local.get $0
      local.get $1
      i32.ne
      local.set $5
     end
     local.get $5
     local.get $4
     local.get $6
     i32.ne
     local.get $5
     select
     select
     if
      local.get $3
      local.get $0
      i32.const 4
      i32.shl
      i32.add
      local.tee $1
      i32.const 8
      i32.add
      local.get $1
      i32.load offset=8
      i32.const 1
      i32.add
      i32.store
     end
     local.get $0
     local.set $1
     local.get $6
     local.set $4
     local.get $7
     local.set $5
     i32.const 1
     local.set $10
     local.get $8
     i32.const 1
     i32.add
     local.set $8
     br $for-loop|3
    end
   end
   i32.const -1
   local.set $1
   i32.const 0
   local.set $4
   i32.const 0
   local.set $5
   loop $for-loop|4
    local.get $5
    local.get $14
    i32.lt_s
    if
     local.get $5
     local.get $23
     i32.add
     i32.load8_u
     local.tee $0
     local.get $2
     i32.ge_s
     if
      i32.const 3
      return
     end
     local.get $22
     local.get $5
     i32.const 2
     i32.shl
     i32.add
     i32.load
     local.set $6
     local.get $9
     if
      local.get $0
      local.get $1
      i32.lt_s
      br_if $folding-inner0
      local.get $0
      local.get $1
      i32.eq
      local.get $4
      local.get $6
      i32.gt_u
      i32.and
      br_if $folding-inner0
     end
     local.get $9
     i32.eqz
     local.get $0
     local.get $1
     i32.ne
     i32.or
     local.get $4
     local.get $6
     i32.ne
     i32.or
     if
      local.get $3
      local.get $0
      i32.const 4
      i32.shl
      i32.add
      local.tee $1
      i32.const 12
      i32.add
      local.get $1
      i32.load offset=12
      i32.const 1
      i32.add
      i32.store
     end
     local.get $0
     local.set $1
     local.get $6
     local.set $4
     i32.const 1
     local.set $9
     local.get $5
     i32.const 1
     i32.add
     local.set $5
     br $for-loop|4
    end
   end
   i32.const 0
   return
  end
  i32.const 6
 )
)
